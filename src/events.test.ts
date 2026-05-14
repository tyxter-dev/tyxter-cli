import { describe, expect, it } from 'vitest';

import { resendListenEvent } from './events.js';
import type { FetchLike } from './http.js';
import { FORWARDED_WEBHOOK_HEADERS } from './listener.js';

describe('events resend', () => {
  it('retrieves a sandbox listen event, strips evt_ input prefixes, and forwards it locally', async () => {
    const urls: string[] = [];
    let forwardedBody = '';
    let forwardedEventId = '';

    const fetchFn: FetchLike = async (input, init) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith('http://api.test/')) {
        return Response.json({
          id: 'outbox_123',
          object: 'webhook_event',
          endpoint_id: null,
          type: 'message.received',
          source_type: 'message',
          source_id: 'msg_123',
          payload: { id: 'evt_outbox_123', type: 'message.received', data: { ok: true } },
          status: 'pending',
          trace_id: 'trc_123',
          created_at: '2026-05-09T12:00:00.000Z',
          attempts: [],
        });
      }

      forwardedBody = String(init?.body ?? '');
      forwardedEventId =
        new Headers(init?.headers).get(FORWARDED_WEBHOOK_HEADERS.ID) ?? '';
      return Response.json({ ok: true });
    };

    const result = await resendListenEvent({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      eventId: 'evt_outbox_123',
      forwardTo: 'http://127.0.0.1:4242/webhooks/tyxter',
      signingSecret: 'whsec_test',
      fetchFn,
    });

    expect(urls[0]).toBe('http://api.test/v1/webhook-events/listen/outbox_123');
    expect(urls[1]).toBe('http://127.0.0.1:4242/webhooks/tyxter');
    expect(forwardedEventId).toBe('outbox_123');
    expect(forwardedBody).toBe(
      JSON.stringify({ id: 'evt_outbox_123', type: 'message.received', data: { ok: true } }),
    );
    expect(result).toMatchObject({
      object: 'tyxter_cli_event_resend',
      event_id: 'outbox_123',
      payload_id: 'evt_outbox_123',
      forwarded: true,
    });
  });
});
