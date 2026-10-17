import { describe, expect, it, vi } from 'vitest';

import { checkpointListenCursor } from './checkpoint.js';
import type { FetchLike } from './http.js';

describe('checkpoint command helper', () => {
  it.each([
    { headers: new Headers({ 'retry-after': '2' }), body: {}, expectedDelay: 2000 },
    { headers: new Headers(), body: { error: { retry_after_ms: 1500 } }, expectedDelay: 1500 },
    { headers: new Headers(), body: {}, expectedDelay: 1000 },
  ])('retries the current page after rate limiting ($expectedDelay ms)', async ({ headers, body, expectedDelay }) => {
    const cursors: Array<string | null> = [];
    const sleeps: number[] = [];
    const onPage = vi.fn();
    const fetchFn: FetchLike = async (input) => {
      cursors.push(new URL(String(input)).searchParams.get('cursor'));
      if (cursors.length === 2) return Response.json(body, { status: 429, headers });
      return Response.json({
        object: 'webhook_event_listen', data: [event(`out_${cursors.length}`)],
        has_more: cursors.length === 1,
        next_cursor: cursors.length === 1 ? 'cur_mid' : 'cur_end',
      });
    };
    const result = await checkpointListenCursor({
      apiUrl: 'http://api.test', apiKey: 'tx_sandbox_test', cursor: 'cur_start', fetchFn,
      onPage, sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(cursors).toEqual(['cur_start', 'cur_mid', 'cur_mid']);
    expect(sleeps).toEqual([expectedDelay]);
    expect(result).toEqual({ cursor: 'cur_end', pages: 2, skipped: 2 });
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it('retries a rate limit on the first page and backs off without server guidance', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    await checkpointListenCursor({
      apiUrl: 'http://api.test', apiKey: 'tx_sandbox_test',
      fetchFn: async () => ++calls < 4
        ? new Response('{}', { status: 429 })
        : Response.json({ object: 'webhook_event_listen', data: [], has_more: false, next_cursor: null }),
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it('cancels a rate-limit wait without fetching another page', async () => {
    const controller = new AbortController();
    let interrupt: ReturnType<typeof setTimeout> | undefined;
    const fetchFn = vi.fn(async () => {
      interrupt = setTimeout(() => controller.abort(), 10);
      return new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
    });
    try {
      await expect(checkpointListenCursor({
        apiUrl: 'http://api.test', apiKey: 'tx_sandbox_test', signal: controller.signal, fetchFn,
      })).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally { clearTimeout(interrupt); }
  });

  it('does not retry authentication failures', async () => {
    const sleep = vi.fn();
    await expect(checkpointListenCursor({
      apiUrl: 'http://api.test', apiKey: 'tx_sandbox_test',
      fetchFn: async () => new Response('{}', { status: 401 }), sleep,
    })).rejects.toMatchObject({ status: 401 });
    expect(sleep).not.toHaveBeenCalled();
  });

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
