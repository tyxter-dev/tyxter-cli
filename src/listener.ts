import { randomBytes } from 'node:crypto';

import { endpointUrl, HttpStatusError, type FetchLike, readFailure } from './http.js';
import { ListenWebhookEventsResponseSchema, type ListenWebhookEventsResponse } from './schemas.js';
import { signWebhook } from './signature.js';

export const FORWARDED_WEBHOOK_HEADERS = {
  ID: 'tyxter-webhook-id',
  TIMESTAMP: 'tyxter-webhook-timestamp',
  SIGNATURE: 'tyxter-webhook-signature',
} as const;

export interface ListenerOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly cursor?: string;
  readonly eventType?: string;
  readonly eventTypes?: readonly string[];
  readonly limit?: number;
  readonly waitMs?: number;
  readonly fetchFn?: FetchLike;
}

export interface ForwardingListenerOptions extends ListenerOptions {
  readonly forwardTo: string;
  readonly signingSecret: string;
  readonly now?: () => number;
}

export interface RunListenerOptions extends ForwardingListenerOptions {
  readonly pollIntervalMs: number;
  readonly maxPollIntervalMs: number;
  readonly once: boolean;
  readonly signal?: AbortSignal;
  readonly onStart?: (details: { signingSecret: string; cursor: string | null }) => void | Promise<void>;
  readonly onRateLimited?: (details: { retryAfterMs: number }) => void | Promise<void>;
  readonly onBatch?: (details: {
    delivered: number;
    eventIds: readonly string[];
    cursor: string | null;
    hasMore: boolean;
  }) => void | Promise<void>;
  readonly random?: () => number;
  readonly jitterRatio?: number;
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

export interface PollResult {
  readonly delivered: number;
  readonly eventIds: readonly string[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly nextPollAfterMs?: number;
}

export interface ListenPage {
  readonly data: ListenWebhookEventsResponse['data'];
  readonly cursor: string | null;
  readonly hasMore: boolean;
  readonly nextPollAfterMs?: number;
}

export function createListenSigningSecret(): string {
  return `whsec_listen_${randomBytes(24).toString('base64url')}`;
}

export async function readListenPage(options: ListenerOptions): Promise<ListenPage> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = endpointUrl(options.apiUrl, '/v1/webhook-events/listen');
  url.searchParams.set('limit', String(options.limit ?? 20));
  if (options.cursor) url.searchParams.set('cursor', options.cursor);
  if (options.eventType) url.searchParams.set('event_type', options.eventType);
  if (options.eventTypes && options.eventTypes.length > 0) {
    url.searchParams.set('event_types', options.eventTypes.join(','));
  }
  if (options.waitMs !== undefined) url.searchParams.set('wait_ms', String(options.waitMs));

  const response = await fetchFn(url, {
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: 'application/json',
    },
  });
  if (!response.ok) await readFailure(response, 'webhook event listen');

  const body = ListenWebhookEventsResponseSchema.parse(await response.json());
  return {
    data: body.data,
    cursor: body.next_cursor,
    hasMore: body.has_more,
    nextPollAfterMs: body.next_poll_after_ms,
  };
}

export async function pollOnce(options: ForwardingListenerOptions): Promise<PollResult> {
  const page = await readListenPage(options);
  const fetchFn = options.fetchFn ?? fetch;
  const eventIds: string[] = [];
  for (const event of page.data) {
    await forwardEvent({
      eventId: event.id,
      payload: event.payload,
      forwardTo: options.forwardTo,
      signingSecret: options.signingSecret,
      fetchFn,
      now: options.now,
    });
    eventIds.push(event.id);
  }

  return {
    delivered: page.data.length,
    eventIds,
    cursor: page.cursor,
    hasMore: page.hasMore,
    nextPollAfterMs: page.nextPollAfterMs,
  };
}

export async function runListener(options: RunListenerOptions): Promise<PollResult> {
  let cursor = options.cursor ?? null;
  let delivered = 0;
  const forwardedEventIds: string[] = [];
  let hasMore = false;
  let nextPollAfterMs: number | undefined;
  let idleDelayMs = options.pollIntervalMs;
  await options.onStart?.({ signingSecret: options.signingSecret, cursor });

  do {
    if (options.signal?.aborted) break;
    let result: PollResult;
    try {
      result = await pollOnce({ ...options, cursor: cursor ?? undefined });
    } catch (error) {
      if (isListenRateLimit(error)) {
        const retryAfterMs = error.retryAfterMs ?? idleDelayMs;
        await options.onRateLimited?.({ retryAfterMs });
        await sleepWithOptions(options, retryAfterMs);
        idleDelayMs = Math.min(options.maxPollIntervalMs, idleDelayMs * 2);
        continue;
      }
      throw error;
    }

    delivered += result.delivered;
    forwardedEventIds.push(...result.eventIds);
    cursor = result.cursor ?? cursor;
    hasMore = result.hasMore;
    nextPollAfterMs = result.nextPollAfterMs;
    await options.onBatch?.({
      delivered: result.delivered,
      eventIds: result.eventIds,
      cursor,
      hasMore,
    });

    if (options.once) break;
    if (!hasMore) {
      const activeDelayMs =
        result.delivered > 0
          ? Math.max(options.pollIntervalMs, result.nextPollAfterMs ?? 0)
          : Math.max(idleDelayMs, result.nextPollAfterMs ?? 0);
      await sleepWithOptions(options, withJitter(activeDelayMs, options));
      idleDelayMs =
        result.delivered > 0
          ? options.pollIntervalMs
          : Math.min(options.maxPollIntervalMs, idleDelayMs * 2);
    } else {
      idleDelayMs = options.pollIntervalMs;
    }
  } while (!options.signal?.aborted);

  return { delivered, eventIds: forwardedEventIds, cursor, hasMore, nextPollAfterMs };
}

export async function forwardEvent(input: {
  eventId: string;
  payload: unknown;
  forwardTo: string;
  signingSecret: string;
  fetchFn: FetchLike;
  now?: () => number;
}): Promise<void> {
  const rawBody = JSON.stringify(input.payload);
  const timestamp = String(Math.floor((input.now?.() ?? Date.now()) / 1000));
  const signature = signWebhook(input.signingSecret, timestamp, rawBody);
  const response = await input.fetchFn(input.forwardTo, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [FORWARDED_WEBHOOK_HEADERS.ID]: input.eventId,
      [FORWARDED_WEBHOOK_HEADERS.TIMESTAMP]: timestamp,
      [FORWARDED_WEBHOOK_HEADERS.SIGNATURE]: signature,
    },
    body: rawBody,
  });
  if (!response.ok) await readFailure(response, 'local webhook forward');
}

function isListenRateLimit(error: unknown): error is HttpStatusError {
  return (
    error instanceof HttpStatusError &&
    error.status === 429 &&
    error.action === 'webhook event listen'
  );
}

function sleepWithOptions(options: RunListenerOptions, ms: number): Promise<void> {
  return (options.sleep ?? sleep)(Math.max(0, Math.ceil(ms)), options.signal);
}

function withJitter(ms: number, options: RunListenerOptions): number {
  const ratio = options.jitterRatio ?? 0.2;
  if (ratio <= 0 || ms <= 0) return ms;
  const random = options.random ?? Math.random;
  const factor = 1 + (random() * 2 - 1) * ratio;
  return Math.max(0, ms * factor);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
