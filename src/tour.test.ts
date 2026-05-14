import { describe, expect, it } from 'vitest';

import { parseCli } from './args.js';
import type { FetchLike } from './http.js';
import { FORWARDED_WEBHOOK_HEADERS } from './listener.js';
import { verifyWebhookSignature } from './signature.js';
import { runTour } from './tour.js';

describe('tour command', () => {
  it('parses tour options from flags and env defaults', () => {
    const parsed = parseCli(
      ['tour', '--api-key', 'tx_sandbox_test', '--forward-to', 'http://127.0.0.1:4242/hook'],
      {
        TYXTER_SIMULATE_FROM: '+15551230000',
        TYXTER_SIMULATE_TO: '+15557650000',
        TYXTER_WEBHOOK_SECRET: 'whsec_tour',
      },
    );

    expect(parsed).toMatchObject({
      kind: 'tour',
      options: {
        apiUrl: 'http://localhost:3001',
        apiKey: 'tx_sandbox_test',
        forwardTo: 'http://127.0.0.1:4242/hook',
        signingSecret: 'whsec_tour',
        from: '+15551230000',
        to: '+15557650000',
        body: 'Hello from Tyxter',
        pollAttempts: 5,
      },
    });
  });

  it('checkpoints existing events, simulates inbound, then forwards only the tour webhook', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    let forwardedBody = '';
    const forwardedHeaders = new Headers();
    let listenCalls = 0;

    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body ?? '') });

      if (
        url === 'http://api.test/v1/webhook-events/listen?limit=100&event_type=message.received'
      ) {
        listenCalls += 1;
        return Response.json({
          object: 'webhook_event_listen',
          data: [
            {
              id: 'out_existing',
              object: 'webhook_event',
              endpoint_id: null,
              type: 'message.received',
              source_type: 'message',
              source_id: 'msg_existing',
              payload: {
                id: 'evt_out_existing',
                type: 'message.received',
                created_at: '2026-05-09T11:59:00.000Z',
                environment: 'sandbox',
                trace_id: 'trc_existing',
                data: {
                  message_id: 'msg_existing',
                  content: {
                    type: 'text',
                    text: { body: 'old event' },
                  },
                },
              },
              status: 'pending',
              trace_id: 'trc_existing',
              created_at: '2026-05-09T11:59:00.000Z',
              attempts: [],
            },
          ],
          has_more: false,
          next_cursor: 'cur_before_tour',
        });
      }

      if (url === 'http://api.test/v1/sandbox/inbound-messages') {
        return Response.json({
          id: 'msg_tour',
          object: 'message',
          status: 'received',
          environment: 'sandbox',
          created_at: '2026-05-09T12:00:00.000Z',
          trace_id: 'trc_tour',
        });
      }

      if (
        url ===
        'http://api.test/v1/webhook-events/listen?limit=100&cursor=cur_before_tour&event_type=message.received'
      ) {
        listenCalls += 1;
        return Response.json({
          object: 'webhook_event_listen',
          data: [
            {
              id: 'out_tour',
              object: 'webhook_event',
              endpoint_id: null,
              type: 'message.received',
              source_type: 'message',
              source_id: 'msg_tour',
              payload: {
                id: 'evt_out_tour',
                type: 'message.received',
                created_at: '2026-05-09T12:00:00.000Z',
                environment: 'sandbox',
                trace_id: 'trc_tour',
                data: {
                  message_id: 'msg_tour',
                  content: {
                    type: 'text',
                    text: { body: 'hello tour' },
                  },
                },
              },
              status: 'pending',
              trace_id: 'trc_tour',
              created_at: '2026-05-09T12:00:00.000Z',
              attempts: [],
            },
          ],
          has_more: false,
          next_cursor: 'cur_tour',
        });
      }

      forwardedBody = String(init?.body ?? '');
      new Headers(init?.headers).forEach((value, key) => forwardedHeaders.set(key, value));
      return Response.json({ ok: true });
    };

    const result = await runTour({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_tour',
      from: '+15551230000',
      to: '+15557650000',
      body: 'hello tour',
      pollAttempts: 1,
      pollIntervalMs: 1,
      now: () => 1_779_444_000_000,
      fetchFn,
    });

    expect(result).toMatchObject({
      attempts: 1,
      listen: { delivered: 1, cursor: 'cur_tour', hasMore: false },
      simulated: { id: 'msg_tour' },
    });
    expect(listenCalls).toBe(2);
    expect(
      JSON.parse(calls.find((call) => call.url.endsWith('/inbound-messages'))?.body ?? '{}'),
    ).toMatchObject({
      from: '+15551230000',
      to: '+15557650000',
      text: { body: 'hello tour' },
      metadata: { source: 'tyxter-cli-tour' },
    });
    expect(forwardedBody).toBe(
      JSON.stringify({
        id: 'evt_out_tour',
        type: 'message.received',
        created_at: '2026-05-09T12:00:00.000Z',
        environment: 'sandbox',
        trace_id: 'trc_tour',
        data: {
          message_id: 'msg_tour',
          content: {
            type: 'text',
            text: { body: 'hello tour' },
          },
        },
      }),
    );

    const timestamp = forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.TIMESTAMP) ?? '';
    const signature = forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.SIGNATURE) ?? '';
    expect(forwardedHeaders.get(FORWARDED_WEBHOOK_HEADERS.ID)).toBe('out_tour');
    expect(
      verifyWebhookSignature({
        secret: 'whsec_tour',
        timestamp,
        rawBody: forwardedBody,
        signature,
        toleranceSeconds: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
  });
});
