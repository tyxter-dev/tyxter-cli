import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFile, mkdir, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release channels', () => {
  it('keeps prerelease and metadata tags off latest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tyxter-release-'));
    try {
      await mkdir(join(dir, 'scripts'));
      const script = join(dir, 'scripts', 'release-metadata.mjs');
      await copyFile('scripts/release-metadata.mjs', script);
      for (const version of ['0.1.0-next.1', '0.1.0+build.1']) {
        await writeFile(join(dir, 'package.json'), JSON.stringify({ version }));
        const { stdout } = await promisify(execFile)(process.execPath, [script], {
          env: { PATH: process.env.PATH, GITHUB_REF: `refs/tags/v${version}` },
        });
        expect(stdout).toBe('stable=false\n');
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('allows latest only for the exact stable package tag', async () => {
    const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
    const dir = await mkdtemp(join(tmpdir(), 'tyxter-release-'));
    try {
      for (const [ref, stable] of [['refs/heads/main', false], [`refs/tags/v${version}`, true]]) {
        const output = join(dir, 'output');
        const result = await promisify(execFile)(process.execPath, ['scripts/release-metadata.mjs'], {
          env: { ...process.env, GITHUB_REF: String(ref), GITHUB_OUTPUT: output },
        });
        expect(result.stdout).toBe(`stable=${stable}\n`);
      }
      await expect(promisify(execFile)(process.execPath, ['scripts/release-metadata.mjs'], {
        env: { ...process.env, GITHUB_REF: 'refs/tags/v999.0.0' },
      })).rejects.toMatchObject({ stderr: expect.stringContaining('must match') });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
