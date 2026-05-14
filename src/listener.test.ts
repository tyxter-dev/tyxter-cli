import { describe, expect, it } from 'vitest';

import { FORWARDED_WEBHOOK_HEADERS, pollOnce } from './listener.js';
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
      now: () => 1_779_444_000_000,
      fetchFn,
    });

    expect(result).toEqual({ delivered: 1, cursor: 'cur_123', hasMore: false });
    expect(listenUrl).toBe('http://api.test/v1/webhook-events/listen?limit=1');
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
});
