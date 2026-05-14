import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import type { FetchLike } from './http.js';
import { FORWARDED_WEBHOOK_HEADERS } from './listener.js';
import { runDoctor } from './doctor.js';
import { verifyWebhookSignature } from './signature.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('doctor command', () => {
  it('checks state, API access, and local forward URL', async () => {
    const stateDir = await tempDir();
    let listenUrl = '';
    let forwardedBody = '';
    const forwardedHeaders = new Headers();

    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.startsWith('http://api.test/')) {
        listenUrl = url;
        return Response.json({
          object: 'webhook_event_listen',
          data: [],
          has_more: false,
          next_cursor: 'cur_doctor',
        });
      }

      forwardedBody = String(init?.body ?? '');
      new Headers(init?.headers).forEach((value, key) => forwardedHeaders.set(key, value));
      return Response.json({ ok: true });
    };

    const result = await runDoctor({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_listen_doctor',
      stateDir,
      now: () => new Date('2026-05-14T00:00:00.000Z'),
      fetchFn,
    });

    expect(result.ok).toBe(true);
    expect(result.signing_secret).toBe('whsec_listen_doctor');
    expect(result.checks.map((check) => [check.name, check.ok])).toEqual([
      ['state', true],
      ['api', true],
      ['forward', true],
    ]);
    expect(listenUrl).toBe('http://api.test/v1/webhook-events/listen?limit=1');
    expect(JSON.parse(forwardedBody)).toMatchObject({
      id: 'evt_listener_diagnostic',
      type: 'listener.diagnostic',
    });
    expect(
      verifyWebhookSignature({
        secret: 'whsec_listen_doctor',
        timestamp: forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.TIMESTAMP) ?? '',
        signature: forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.SIGNATURE) ?? '',
        rawBody: forwardedBody,
        toleranceSeconds: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tyxter-cli-'));
  dirs.push(dir);
  return dir;
}
