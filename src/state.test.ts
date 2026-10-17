import { chmod, mkdir, mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { readListenerState, resolveListenerState, stateFilePath, writeListenerState } from './state.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('listener state', () => {
  it('persists a generated signing secret and cursor', async () => {
    const stateDir = await tempDir();

    const first = await resolveListenerState({
      stateDir,
      cursor: 'cur_1',
      now: () => new Date('2026-05-14T00:00:00.000Z'),
    });
    const second = await resolveListenerState({
      stateDir,
      now: () => new Date('2026-05-14T00:01:00.000Z'),
    });

    expect(first.signingSecret).toMatch(/^whsec_listen_/);
    expect(second.signingSecret).toBe(first.signingSecret);
    expect(second.cursor).toBe('cur_1');
    expect(await readListenerState(stateDir)).toMatchObject({
      signingSecret: first.signingSecret,
      cursor: 'cur_1',
    });
  });

  it('lets explicit values override stored state', async () => {
    const stateDir = await tempDir();
    await resolveListenerState({
      stateDir,
      signingSecret: 'whsec_listen_old',
      cursor: 'cur_old',
    });

    const next = await resolveListenerState({
      stateDir,
      signingSecret: 'whsec_listen_new',
      cursor: 'cur_new',
    });

    expect(next).toMatchObject({
      signingSecret: 'whsec_listen_new',
      cursor: 'cur_new',
    });
  });

  it('round-trips custom local secrets and rejects empty secrets before replacing state', async () => {
    const stateDir = await tempDir();
    await resolveListenerState({ stateDir, signingSecret: 'local-test-secret' });
    expect((await readListenerState(stateDir))?.signingSecret).toBe('local-test-secret');
    await expect(resolveListenerState({ stateDir, signingSecret: '' })).rejects.toThrow('invalid signingSecret');
    expect((await readListenerState(stateDir))?.signingSecret).toBe('local-test-secret');
  });

  it('serializes initialization across processes and retains one signing secret', async () => {
    const stateDir = await tempDir();
    const script = `import {resolveListenerState} from ${JSON.stringify(new URL('./state.ts', import.meta.url).href)}; const state = await resolveListenerState({stateDir:process.argv[1]}); process.stdout.write(state.signingSecret);`;
    const results = await Promise.all(Array.from({ length: 6 }, () => promisify(execFile)(process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script, stateDir])));
    expect(results.every((result) => result.stderr === '')).toBe(true);
    expect(new Set(results.map((result) => result.stdout)).size).toBe(1);
    expect(await readListenerState(stateDir)).not.toBeNull();
    // The first creation is never rewritten by read-only diagnostics.
    const before = await readFile(stateFilePath(stateDir), 'utf8');
    await Promise.all(Array.from({ length: 10 }, () => resolveListenerState({ stateDir })));
    expect(await readFile(stateFilePath(stateDir), 'utf8')).toBe(before);
  });

  it('keeps concurrent writes intact and diagnostics preserve the latest cursor', async () => {
    const stateDir = await tempDir();
    const state = await resolveListenerState({ stateDir });
    await Promise.all(Array.from({ length: 30 }, (_, i) => writeListenerState(stateDir, {
      ...state, cursor: `cur_${i}`,
    })));
    await writeListenerState(stateDir, { ...state, cursor: 'cur_latest' });
    await Promise.all(Array.from({ length: 10 }, () => resolveListenerState({ stateDir })));
    expect((await readListenerState(stateDir))?.cursor).toBe('cur_latest');
  });

  it('recovers a stale lock left by a terminated process', async () => {
    const stateDir = await tempDir();
    const path = join(stateDir, '.listener-state.lock');
    await mkdir(path);
    const old = new Date(Date.now() - 30_000);
    await utimes(path, old, old);
    await expect(resolveListenerState({ stateDir })).resolves.toMatchObject({ cursor: null });
  });

  it.skipIf(process.platform === 'win32')('restricts new state and repairs existing permissions', async () => {
    const stateDir = await tempDir();
    await resolveListenerState({ stateDir });
    await chmod(stateDir, 0o755);
    await chmod(stateFilePath(stateDir), 0o644);
    await resolveListenerState({ stateDir });
    expect((await stat(stateDir)).mode & 0o777).toBe(0o700);
    expect((await stat(stateFilePath(stateDir))).mode & 0o777).toBe(0o600);
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tyxter-cli-'));
  dirs.push(dir);
  return dir;
}
