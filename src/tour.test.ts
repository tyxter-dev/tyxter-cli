import { describe, expect, it } from 'vitest';

import { DEFAULT_API_URL, parseCli } from './args.js';
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
        apiUrl: DEFAULT_API_URL,
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
              id: 'out_concurrent',
              object: 'webhook_event',
              endpoint_id: null,
              type: 'message.received',
              source_type: 'message',
              source_id: 'msg_concurrent',
              payload: {
                id: 'evt_out_concurrent',
                type: 'message.received',
                created_at: '2026-05-09T12:00:00.000Z',
                environment: 'sandbox',
                trace_id: 'trc_concurrent',
                data: {
                  message_id: 'msg_concurrent',
                  content: {
                    type: 'text',
                    text: { body: 'another message' },
                  },
                },
              },
              status: 'pending',
              trace_id: 'trc_concurrent',
              created_at: '2026-05-09T12:00:00.000Z',
              attempts: [],
            },
          ],
          has_more: false,
          next_cursor: 'cur_concurrent',
        });
      }

      if (
        url ===
        'http://api.test/v1/webhook-events/listen?limit=100&cursor=cur_concurrent&event_type=message.received'
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
                created_at: '2026-05-09T12:00:01.000Z',
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
              created_at: '2026-05-09T12:00:01.000Z',
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
      channel: 'instagram',
      from: '+15551230000',
      to: '+15557650000',
      body: 'hello tour',
      pollAttempts: 2,
      pollIntervalMs: 1,
      now: () => 1_779_444_000_000,
      fetchFn,
    });

    expect(result).toMatchObject({
      attempts: 2,
      listen: { delivered: 1, cursor: 'cur_tour', hasMore: false },
      simulated: { id: 'msg_tour' },
    });
    expect(listenCalls).toBe(3);
    expect(
      JSON.parse(calls.find((call) => call.url.endsWith('/inbound-messages'))?.body ?? '{}'),
    ).toMatchObject({
      channel: 'instagram',
      from: '+15551230000',
      to: '+15557650000',
      text: { body: 'hello tour' },
      metadata: { source: 'tyxter-cli-tour' },
    });
    expect(forwardedBody).toBe(
      JSON.stringify({
        id: 'evt_out_tour',
        type: 'message.received',
        created_at: '2026-05-09T12:00:01.000Z',
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

describe('tour polling backoff', () => {
  const options = {
    apiUrl: 'http://api.test', apiKey: 'tx_sandbox_test',
    forwardTo: 'http://receiver.test', signingSecret: 'test-secret',
    from: 'test-from', to: 'test-to', body: 'test', cursor: 'cur_start',
    pollAttempts: 2, pollIntervalMs: 1000,
  };
  const simulated = {
    id: 'msg_test', object: 'message', status: 'received', environment: 'sandbox',
    created_at: '2026-05-09T12:00:00.000Z', trace_id: 'trc_test',
  };
  const page = (delivered: boolean, cursor: string, nextPollAfterMs = 0) => Response.json({
    object: 'webhook_event_listen',
    data: delivered ? [{ id: 'event_test', source_id: simulated.id, payload: {} }] : [],
    has_more: false, next_cursor: cursor, next_poll_after_ms: nextPollAfterMs,
  });

  it('retries the same cursor without consuming attempts or simulating again', async () => {
    const sleeps: number[] = [];
    const cursors: Array<string | null> = [];
    let simulations = 0;
    const responses = [
      page(false, 'cur_next', 4000),
      new Response('{}', { status: 429, headers: { 'retry-after': '2' } }),
      Response.json({ error: { retry_after_ms: 3500 } }, { status: 429 }),
      page(true, 'cur_done'),
    ];
    const result = await runTour({
      ...options, sleep: async (ms) => { sleeps.push(ms); },
      fetchFn: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('inbound-messages')) {
          simulations++;
          return Response.json(simulated);
        }
        if (url.hostname === 'receiver.test') return new Response(null, { status: 204 });
        cursors.push(url.searchParams.get('cursor'));
        return responses.shift()!;
      },
    });
    expect(result).toMatchObject({ attempts: 2, listen: { delivered: 1, cursor: 'cur_done' } });
    expect(simulations).toBe(1);
    expect(cursors).toEqual(['cur_start', 'cur_next', 'cur_next', 'cur_next']);
    expect(sleeps).toEqual([4000, 2000, 3500]);
  });

  it('caps fallback backoff and resets it after a successful poll', async () => {
    const sleeps: number[] = [];
    let polls = 0;
    await runTour({
      ...options, pollIntervalMs: 20_000,
      sleep: async (ms) => { sleeps.push(ms); },
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes('inbound-messages')) return Response.json(simulated);
        if (url.includes('receiver.test')) return new Response(null, { status: 204 });
        polls++;
        if (polls === 4) return page(false, 'cur_next', 1000);
        if (polls === 6) return page(true, 'cur_done');
        return new Response('{}', { status: 429 });
      },
    });
    expect(sleeps).toEqual([20_000, 30_000, 30_000, 20_000, 20_000]);
  });

  it.each([429, 500])('does not retry local forwarding failures with HTTP %i', async (status) => {
    let forwards = 0;
    const sleeps: number[] = [];
    await expect(runTour({
      ...options, sleep: async (ms) => { sleeps.push(ms); },
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes('inbound-messages')) return Response.json(simulated);
        if (url.includes('receiver.test')) {
          forwards++;
          return new Response('{}', { status });
        }
        return page(true, 'cur_done');
      },
    })).rejects.toMatchObject({ status, action: 'local webhook forward' });
    expect(forwards).toBe(1);
    expect(sleeps).toEqual([]);
  });
});
