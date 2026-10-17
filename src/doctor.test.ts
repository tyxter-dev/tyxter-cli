import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FetchLike } from './http.js';
import { FORWARDED_WEBHOOK_HEADERS } from './listener.js';
import { runDoctor } from './doctor.js';
import { verifyWebhookSignature } from './signature.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('doctor command', () => {
  it.each(['api headers', 'api body', 'forward headers'])('reports a timeout for stalled %s and completes the other checks', async (phase) => {
    const stateDir = await tempDir();
    let timedOutSignal: AbortSignal | undefined;
    const result = await runDoctor({
      apiUrl: 'http://api.test', apiKey: 'tx_sandbox_test', forwardTo: 'http://local.test/hook',
      stateDir, requestTimeoutMs: 20,
      fetchFn: async (input, init) => {
        const api = String(input).startsWith('http://api.test');
        const signal = init?.signal;
        if (!signal) throw new Error('Missing request signal');
        if ((api && phase.startsWith('api')) || (!api && phase === 'forward headers')) {
          timedOutSignal = signal;
          if (phase === 'api body') {
            return new Response(new ReadableStream({
              start(controller) {
                signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
              },
            }));
          }
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        }
        return api
          ? Response.json({ object: 'webhook_event_listen', data: [], has_more: false, next_cursor: null })
          : new Response(null, { status: 204 });
      },
    });
    const failed = phase.startsWith('api') ? 'api' : 'forward';
    expect(result.ok).toBe(false);
    expect(result.checks.filter((check) => !check.ok)).toEqual([
      expect.objectContaining({ name: failed, message: expect.stringContaining('Request timed out') }),
    ]);
    expect(timedOutSignal?.aborted).toBe(true);
  });

  it.each([200, 400])('cancels the unused diagnostic response body for HTTP %s', async (status) => {
    const cancel = vi.fn();
    const result = await runDoctor({
      apiUrl: 'http://api.test', apiKey: 'tx_sandbox_test', forwardTo: 'http://local.test/hook',
      stateDir: await tempDir(),
      fetchFn: async (input) => String(input).startsWith('http://api.test')
        ? Response.json({ object: 'webhook_event_listen', data: [], has_more: false, next_cursor: null })
        : new Response(new ReadableStream({ cancel }), { status }),
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.checks.find((check) => check.name === 'forward')?.ok).toBe(status === 200);
  });

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
    expect(listenUrl).toBe('http://api.test/v1/webhook-events/listen?limit=1&wait_ms=0');
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

  it('keeps a structured report when the local forward URL is down', async () => {
    const stateDir = await tempDir();
    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      if (url.startsWith('http://api.test/')) {
        return Response.json({
          object: 'webhook_event_listen',
          data: [],
          has_more: false,
          next_cursor: 'cur_doctor',
        });
      }

      const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4242'), {
        code: 'ECONNREFUSED',
        syscall: 'connect',
        address: '127.0.0.1',
        port: 4242,
      });
      const error = new TypeError('fetch failed');
      error.cause = cause;
      throw error;
    };

    const result = await runDoctor({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_listen_doctor',
      stateDir,
      fetchFn,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.map((check) => [check.name, check.ok])).toEqual([
      ['state', true],
      ['api', true],
      ['forward', false],
    ]);
    expect(result.checks[2]?.message).toContain(
      'http://127.0.0.1:4242/webhooks/tyxter failed: fetch failed',
    );
    expect(result.checks[2]?.message).toContain('ECONNREFUSED');
    expect(result.checks[2]?.message).toContain('127.0.0.1:4242');
  });
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tyxter-cli-'));
  dirs.push(dir);
  return dir;
}
