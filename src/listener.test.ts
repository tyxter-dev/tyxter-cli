import { describe, expect, it } from 'vitest';

import { FORWARDED_WEBHOOK_HEADERS, pollOnce, runListener } from './listener.js';
import type { FetchLike } from './http.js';
import { verifyWebhookSignature } from './signature.js';

describe('webhook listener', () => {
  it('polls the sandbox listen endpoint and forwards the webhook payload with Tyxter signature headers', async () => {
    let listenUrl = '';
    let authorization = '';
    let forwardedBody = '';
    const forwardedHeaders = new Headers();

    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.startsWith('http://api.test/')) {
        listenUrl = url;
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return Response.json({
          object: 'webhook_event_listen',
          data: [
            {
              id: 'whev_123',
              object: 'webhook_event',
              endpoint_id: null,
              type: 'message.received',
              source_type: 'message',
              source_id: 'msg_123',
              payload: {
                id: 'evt_123',
                type: 'message.received',
                data: {
                  message_id: 'msg_123',
                  content: {
                    type: 'text',
                    text: { body: 'hello' },
                  },
                },
              },
              status: 'pending',
              trace_id: 'trc_123',
              created_at: '2026-05-09T12:00:00.000Z',
              attempts: [],
            },
          ],
          has_more: false,
          next_cursor: 'cur_123',
          next_poll_after_ms: 1000,
        });
      }

      forwardedBody = String(init?.body ?? '');
      new Headers(init?.headers).forEach((value, key) => forwardedHeaders.set(key, value));
      return Response.json({ ok: true });
    };

    const result = await pollOnce({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_test',
      limit: 1,
      waitMs: 25_000,
      now: () => 1_779_444_000_000,
      fetchFn,
    });

    expect(result).toEqual({
      delivered: 1,
      cursor: 'cur_123',
      hasMore: false,
      nextPollAfterMs: 1000,
    });
    expect(listenUrl).toBe('http://api.test/v1/webhook-events/listen?limit=1&wait_ms=25000');
    expect(authorization).toBe('Bearer tx_sandbox_test');
    expect(forwardedBody).toBe(
      JSON.stringify({
        id: 'evt_123',
        type: 'message.received',
        data: {
          message_id: 'msg_123',
          content: {
            type: 'text',
            text: { body: 'hello' },
          },
        },
      }),
    );

    const timestamp = forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.TIMESTAMP) ?? '';
    const signature = forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.SIGNATURE) ?? '';
    expect(forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.ID)).toBe('whev_123');
    expect(timestamp).toBe('1779444000');
    expect(
      verifyWebhookSignature({
        secret: 'whsec_test',
        timestamp,
        rawBody: forwardedBody,
        signature,
        toleranceSeconds: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
  });

  it('backs off idle polling, uses server guidance, and resets after delivered events', async () => {
    const controller = new AbortController();
    const sleepMs: number[] = [];
    let listenCalls = 0;

    const fetchFn: FetchLike = async (input) => {
      if (!String(input).startsWith('http://api.test/')) return Response.json({ ok: true });
      listenCalls += 1;
      if (listenCalls === 3) {
        return Response.json(listenResponse([{ id: 'whev_backoff', payload: { ok: true } }], {
          cursor: 'cur_backoff',
          nextPollAfterMs: 1000,
        }));
      }
      return Response.json(
        listenResponse([], { cursor: null, nextPollAfterMs: listenCalls === 1 ? 3000 : 1000 }),
      );
    };

    const result = await runListener({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_test',
      pollIntervalMs: 1000,
      maxPollIntervalMs: 30_000,
      once: false,
      signal: controller.signal,
      jitterRatio: 0,
      fetchFn,
      sleep: async (ms) => {
        sleepMs.push(ms);
        if (sleepMs.length === 3) controller.abort();
      },
    });

    expect(result.delivered).toBe(1);
    expect(sleepMs).toEqual([3000, 2000, 1000]);
  });

  it('honors Retry-After on listen rate limits and keeps listening', async () => {
    const controller = new AbortController();
    const sleepMs: number[] = [];
    let listenCalls = 0;

    const fetchFn: FetchLike = async (input) => {
      if (!String(input).startsWith('http://api.test/')) return Response.json({ ok: true });
      listenCalls += 1;
      if (listenCalls === 1) {
        return new Response(JSON.stringify({ error: { code: 'rate_limited' } }), {
          status: 429,
          headers: { 'retry-after': '2' },
        });
      }
      return Response.json(listenResponse([], { cursor: null, nextPollAfterMs: 3000 }));
    };

    await runListener({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_test',
      pollIntervalMs: 1000,
      maxPollIntervalMs: 30_000,
      once: false,
      signal: controller.signal,
      jitterRatio: 0,
      fetchFn,
      sleep: async (ms) => {
        sleepMs.push(ms);
        if (sleepMs.length === 2) controller.abort();
      },
    });

    expect(listenCalls).toBe(2);
    expect(sleepMs).toEqual([2000, 3000]);
  });

  it('honors error.retry_after_ms when Retry-After is absent', async () => {
    const controller = new AbortController();
    const sleepMs: number[] = [];
    let listenCalls = 0;

    const fetchFn: FetchLike = async (input) => {
      if (!String(input).startsWith('http://api.test/')) return Response.json({ ok: true });
      listenCalls += 1;
      if (listenCalls === 1) {
        return new Response(
          JSON.stringify({ error: { code: 'rate_limited', retry_after_ms: 1500 } }),
          { status: 429 },
        );
      }
      return Response.json(listenResponse([], { cursor: null, nextPollAfterMs: 3000 }));
    };

    await runListener({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_test',
      pollIntervalMs: 1000,
      maxPollIntervalMs: 30_000,
      once: false,
      signal: controller.signal,
      jitterRatio: 0,
      fetchFn,
      sleep: async (ms) => {
        sleepMs.push(ms);
        if (sleepMs.length === 2) controller.abort();
      },
    });

    expect(listenCalls).toBe(2);
    expect(sleepMs).toEqual([1500, 3000]);
  });
});

function listenResponse(
  data: Array<{ id: string; payload: unknown }>,
  options: { cursor: string | null; hasMore?: boolean; nextPollAfterMs?: number },
) {
  return {
    object: 'webhook_event_listen',
    data,
    has_more: options.hasMore ?? false,
    next_cursor: options.cursor,
    next_poll_after_ms: options.nextPollAfterMs,
  };
}
