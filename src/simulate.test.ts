import { describe, expect, it } from 'vitest';

import type { FetchLike } from './http.js';
import { simulateInboundMessage } from './simulate.js';

describe('sandbox simulator', () => {
  it('posts inbound simulations through the public sandbox endpoint', async () => {
    let url = '';
    let body = '';
    let headers = new Headers();
    const fetchFn: FetchLike = async (input, init) => {
      url = String(input);
      body = String(init?.body ?? '');
      headers = new Headers(init?.headers);
      return Response.json({
        id: 'msg_123',
        object: 'message',
        status: 'received',
        environment: 'sandbox',
        created_at: '2026-05-09T12:00:00.000Z',
        trace_id: 'trc_123',
      });
    };

    const result = await simulateInboundMessage({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      channel: 'instagram',
      from: '+15551230000',
      to: '+15557650000',
      body: 'hello',
      traceId: 'trc_123',
      idempotencyKey: 'idem_123',
      fetchFn,
    });

    expect(result.id).toBe('msg_123');
    expect(url).toBe('http://api.test/v1/sandbox/inbound-messages');
    expect(headers.get('authorization')).toBe('Bearer tx_sandbox_test');
    expect(headers.get('tyxter-trace-id')).toBe('trc_123');
    expect(headers.get('idempotency-key')).toBe('idem_123');
    expect(JSON.parse(body)).toEqual({
      channel: 'instagram',
      from: '+15551230000',
      to: '+15557650000',
      type: 'text',
      text: { body: 'hello' },
    });
  });
});
