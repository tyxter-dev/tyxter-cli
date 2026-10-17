import { endpointUrl, type FetchLike, readFailure, withRequestTimeout } from './http.js';
import {
  WebhookListenSessionResponseSchema,
  type WebhookListenSessionResponse,
} from './schemas.js';

export interface CreateWebhookListenSessionOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly ttlSeconds?: number;
  readonly reason?: string;
  readonly fetchFn?: FetchLike;
}

export interface DisableWebhookListenSessionOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly listenSessionId: string;
  readonly fetchFn?: FetchLike;
}

export async function createWebhookListenSession(
  options: CreateWebhookListenSessionOptions,
): Promise<WebhookListenSessionResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const body: Record<string, unknown> = {};
  if (options.ttlSeconds !== undefined) body.ttl_seconds = options.ttlSeconds;
  if (options.reason) body.reason = options.reason;

  // Keep creation alive briefly after an interrupt so the caller can recover the
  // session id and disable it. Never use the listener's aborted signal here.
  return withRequestTimeout(undefined, 5_000, async (signal) => {
    const response = await fetchFn(endpointUrl(options.apiUrl, '/v1/webhook-events/listen-sessions'), {
      signal,
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) await readFailure(response, 'webhook listen session create');
    return WebhookListenSessionResponseSchema.parse(await response.json());
  });
}

export async function disableWebhookListenSession(
  options: DisableWebhookListenSessionOptions,
): Promise<WebhookListenSessionResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  return withRequestTimeout(undefined, 3_000, async (signal) => {
    const response = await fetchFn(
      endpointUrl(
        options.apiUrl,
        `/v1/webhook-events/listen-sessions/${encodeURIComponent(options.listenSessionId)}`,
      ),
      {
        signal,
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          accept: 'application/json',
        },
      },
    );
    if (!response.ok) await readFailure(response, 'webhook listen session disable');
    return WebhookListenSessionResponseSchema.parse(await response.json());
  });
}
