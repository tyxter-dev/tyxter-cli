import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { readListenerState, resolveListenerState } from './state.js';

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
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tyxter-listener-'));
  dirs.push(dir);
  return dir;
}
