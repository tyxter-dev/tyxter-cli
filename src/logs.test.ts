import { describe, expect, it } from 'vitest';

import type { FetchLike } from './http.js';
import { readWebhookEventsPage, tailWebhookLogs } from './logs.js';
import type { WebhookEventLog } from './schemas.js';

describe('webhook logs tail', () => {
  it('reads webhook event pages with multi-event and status filters', async () => {
    let url = '';
    const fetchFn: FetchLike = async (input) => {
      url = String(input);
      return Response.json(listResponse([]));
    };

    await readWebhookEventsPage({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      eventTypes: ['message.sent', 'message.failed'],
      status: 'failed',
      limit: 10,
      fetchFn,
    });

    expect(url).toBe(
      'http://api.test/v1/webhook-events?limit=10&event_types=message.sent%2Cmessage.failed&status=failed',
    );
  });

  it('seeds current events by default and emits only new unseen events', async () => {
    const controller = new AbortController();
    const emitted: string[] = [];
    let calls = 0;
    const fetchFn: FetchLike = async () => {
      calls += 1;
      if (calls === 1) return Response.json(listResponse([event('old_1')]));
      return Response.json(listResponse([event('new_1'), event('old_1')]));
    };

    const result = await tailWebhookLogs({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      last: 0,
      pollIntervalMs: 1000,
      signal: controller.signal,
      fetchFn,
      sleep: async () => {
        if (calls === 2) controller.abort();
      },
      onEvent: (entry) => {
        emitted.push(entry.id);
      },
    });

    expect(emitted).toEqual(['new_1']);
    expect(result.emitted).toBe(1);
  });

  it('prints historical --last events oldest first before tailing', async () => {
    const controller = new AbortController();
    const emitted: string[] = [];
    const fetchFn: FetchLike = async () =>
      Response.json(listResponse([event('newer'), event('older')]));

    await tailWebhookLogs({
      apiUrl: 'http://api.test',
      apiKey: 'tx_sandbox_test',
      last: 2,
      pollIntervalMs: 1000,
      signal: controller.signal,
      fetchFn,
      sleep: async () => controller.abort(),
      onEvent: (entry) => {
        emitted.push(entry.id);
      },
    });

    expect(emitted).toEqual(['older', 'newer']);
  });
});

function listResponse(data: WebhookEventLog[]) {
  return {
    object: 'list',
    data,
    has_more: false,
    next_cursor: null,
  };
}

function event(id: string): WebhookEventLog {
  return {
    id,
    object: 'webhook_event',
    endpoint_id: 'wep_123',
    type: 'message.sent',
    source_type: 'message',
    source_id: `msg_${id}`,
    payload: { id: `evt_${id}` },
    status: 'delivered',
    trace_id: `trc_${id}`,
    created_at: `2026-05-09T12:00:0${id === 'older' ? 1 : 2}.000Z`,
    attempts: [],
  };
}
