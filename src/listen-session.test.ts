import { describe, expect, it, vi } from 'vitest';

import type { FetchLike } from './http.js';
import {
  createWebhookListenSession,
  disableWebhookListenSession,
} from './listen-session.js';

describe('production webhook listen sessions', () => {
  it('bounds creation and cleanup requests including pending responses', async () => {
    vi.useFakeTimers();
    const fetchFn: FetchLike = async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
    try {
      const creation = expect(createWebhookListenSession({ apiUrl: 'http://api.test', apiKey: 'tx_live_test', fetchFn })).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(5000);
      await creation;
      const cleanup = expect(disableWebhookListenSession({ apiUrl: 'http://api.test', apiKey: 'tx_live_test', listenSessionId: 'wls_test', fetchFn })).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(3000);
      await cleanup;
    } finally { vi.useRealTimers(); }
  });
  it('creates a short-lived production listen session', async () => {
    let requestUrl = '';
    let requestBody = '';
    let authorization = '';
    const fetchFn: FetchLike = async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body ?? '');
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json(sessionResponse({ status: 'active', disabled_at: null }));
    };

    const result = await createWebhookListenSession({
      apiUrl: 'http://api.test',
      apiKey: 'tx_live_test',
      ttlSeconds: 120,
      reason: 'prod smoke test',
      fetchFn,
    });

    expect(requestUrl).toBe('http://api.test/v1/webhook-events/listen-sessions');
    expect(authorization).toBe('Bearer tx_live_test');
    expect(JSON.parse(requestBody)).toEqual({
      ttl_seconds: 120,
      reason: 'prod smoke test',
    });
    expect(result).toMatchObject({
      id: 'wls_123',
      object: 'webhook_listen_session',
      environment: 'production',
      status: 'active',
    });
  });

  it('disables a production listen session', async () => {
    let requestUrl = '';
    let requestMethod = '';
    const fetchFn: FetchLike = async (input, init) => {
      requestUrl = String(input);
      requestMethod = init?.method ?? '';
      return Response.json(
        sessionResponse({ status: 'disabled', disabled_at: '2026-05-29T12:01:00.000Z' }),
      );
    };

    const result = await disableWebhookListenSession({
      apiUrl: 'http://api.test',
      apiKey: 'tx_live_test',
      listenSessionId: 'wls 123',
      fetchFn,
    });

    expect(requestUrl).toBe('http://api.test/v1/webhook-events/listen-sessions/wls%20123');
    expect(requestMethod).toBe('DELETE');
    expect(result.status).toBe('disabled');
    expect(result.disabled_at).toBe('2026-05-29T12:01:00.000Z');
  });
});

function sessionResponse(input: {
  status: 'active' | 'disabled' | 'expired';
  disabled_at: string | null;
}) {
  return {
    id: 'wls_123',
    object: 'webhook_listen_session',
    environment: 'production',
    status: input.status,
    expires_at: '2026-05-29T12:05:00.000Z',
    disabled_at: input.disabled_at,
    created_at: '2026-05-29T12:00:00.000Z',
    trace_id: 'trc_123',
    poll_endpoint: '/v1/webhook-events/listen',
    retrieve_endpoint: '/v1/webhook-events/listen/:outbox_event_id',
  };
}
