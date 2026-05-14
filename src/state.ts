import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
  const existing = await readListenerState(options.stateDir);
  const state: ListenerState = {
    signingSecret:
      options.signingSecret ?? existing?.signingSecret ?? createListenSigningSecret(),
    cursor: options.cursor ?? existing?.cursor ?? null,
    updatedAt: (options.now?.() ?? new Date()).toISOString(),
  };
  await writeListenerState(options.stateDir, state);
  return state;
}

export async function writeListenerState(stateDir: string, state: ListenerState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  const path = stateFilePath(stateDir);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

function parseListenerState(value: unknown): ListenerState {
  if (!value || typeof value !== 'object') {
    throw new Error('Listener state file is not a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const signingSecret = record.signingSecret;
  const cursor = record.cursor;
  const updatedAt = record.updatedAt;
  if (typeof signingSecret !== 'string' || !signingSecret.startsWith('whsec_')) {
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
