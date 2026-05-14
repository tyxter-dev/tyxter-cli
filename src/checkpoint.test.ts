import { describe, expect, it } from 'vitest';

import { checkpointListenCursor } from './checkpoint.js';
import type { FetchLike } from './http.js';

describe('checkpoint command helper', () => {
  it('advances through listen pages without forwarding payloads', async () => {
    const urls: string[] = [];
    const pages: Array<{ skipped: number; cursor: string | null; hasMore: boolean }> = [];

    const fetchFn: FetchLike = async (input) => {
      const url = String(input);
      urls.push(url);

      if (
        url ===
        'http://api.test/v1/webhook-events/listen?limit=100&cursor=cur_start&event_type=message.received'
      ) {
        return Response.json({
          object: 'webhook_event_listen',
          data: [event('out_1')],
          has_more: true,
          next_cursor: 'cur_mid',
        });
      }

      if (
        url ===
        'http://api.test/v1/webhook-events/listen?limit=100&cursor=cur_mid&event_type=message.received'
      ) {
        return Response.json({
          object: 'webhook_event_listen',
          data: [event('out_2'), event('out_3')],
          has_more: false,
          next_cursor: 'cur_end',
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    };

    const result = await checkpointListenCursor({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      cursor: 'cur_start',
      eventType: 'message.received',
      limit: 100,
      fetchFn,
      onPage: (page) => {
        pages.push(page);
      },
    });

    expect(result).toEqual({ cursor: 'cur_end', pages: 2, skipped: 3 });
    expect(pages).toEqual([
      { skipped: 1, cursor: 'cur_mid', hasMore: true },
      { skipped: 2, cursor: 'cur_end', hasMore: false },
    ]);
    expect(urls).toEqual([
      'http://api.test/v1/webhook-events/listen?limit=100&cursor=cur_start&event_type=message.received',
      'http://api.test/v1/webhook-events/listen?limit=100&cursor=cur_mid&event_type=message.received',
    ]);
  });
});

function event(id: string): Record<string, unknown> {
  return {
    id,
    object: 'webhook_event',
    endpoint_id: null,
    type: 'message.received',
    source_type: 'message',
    source_id: id.replace('out_', 'msg_'),
    payload: {
      id: `evt_${id}`,
      type: 'message.received',
      created_at: '2026-05-09T12:00:00.000Z',
      environment: 'sandbox',
      trace_id: `trc_${id}`,
      data: {
        message_id: id.replace('out_', 'msg_'),
        content: {
          type: 'text',
          text: { body: 'old event' },
        },
      },
    },
    status: 'pending',
    trace_id: `trc_${id}`,
    created_at: '2026-05-09T12:00:00.000Z',
    attempts: [],
  };
}
