import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';

import { createListenSigningSecret } from './listener.js';

export const DEFAULT_STATE_DIR = '.tyxter-cli';
export const STATE_FILE_NAME = 'listener-state.json';

export interface ListenerState {
  readonly signingSecret: string;
  readonly cursor: string | null;
  readonly updatedAt: string;
}

export interface ResolveListenerStateOptions {
  readonly stateDir: string;
  readonly signingSecret?: string;
  readonly cursor?: string;
  readonly now?: () => Date;
}

export function stateFilePath(stateDir: string): string {
  return join(stateDir, STATE_FILE_NAME);
}

export async function readListenerState(stateDir: string): Promise<ListenerState | null> {
  try {
    const raw = await readFile(stateFilePath(stateDir), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseListenerState(parsed);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function resolveListenerState(
  options: ResolveListenerStateOptions,
): Promise<ListenerState> {
  return withStateLock(options.stateDir, async () => {
    const existing = await readListenerState(options.stateDir);
    if (existing) await chmod(stateFilePath(options.stateDir), 0o600);
    const state: ListenerState = {
      signingSecret:
        options.signingSecret ?? existing?.signingSecret ?? createListenSigningSecret(),
      cursor: options.cursor ?? existing?.cursor ?? null,
      updatedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    // Diagnostics must not rewrite an existing cursor from a stale snapshot.
    if (
      existing && state.signingSecret === existing.signingSecret && state.cursor === existing.cursor
    ) {
      return existing;
    }
    await writeStateAtomically(options.stateDir, state);
    return state;
  });
}

export async function writeListenerState(stateDir: string, state: ListenerState): Promise<void> {
  await withStateLock(stateDir, () => writeStateAtomically(stateDir, state));
}

async function withStateLock<T>(stateDir: string, update: () => Promise<T>): Promise<T> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  const release = await lock(stateDir, {
    lockfilePath: join(stateDir, '.listener-state.lock'),
    stale: 5_000,
    update: 2_000,
    retries: { retries: 100, minTimeout: 10, maxTimeout: 100, factor: 1.2 },
  });
  try {
    return await update();
  } finally {
    await release();
  }
}

async function writeStateAtomically(stateDir: string, state: ListenerState): Promise<void> {
  parseListenerState(state);
  const path = stateFilePath(stateDir);
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8', mode: 0o600, flag: 'wx',
    });
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

function parseListenerState(value: unknown): ListenerState {
  if (!value || typeof value !== 'object') {
    throw new Error('Listener state file is not a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const signingSecret = record.signingSecret;
  const cursor = record.cursor;
  const updatedAt = record.updatedAt;
  if (typeof signingSecret !== 'string' || signingSecret.length === 0) {
    throw new Error('Listener state file has an invalid signingSecret.');
  }
  if (cursor !== null && cursor !== undefined && typeof cursor !== 'string') {
    throw new Error('Listener state file has an invalid cursor.');
  }
  if (typeof updatedAt !== 'string') {
    throw new Error('Listener state file has an invalid updatedAt.');
  }
  return {
    signingSecret,
    cursor: cursor ?? null,
    updatedAt,
  };
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
