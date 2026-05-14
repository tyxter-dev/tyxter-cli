import { randomBytes } from 'node:crypto';

import { endpointUrl, type FetchLike, readFailure } from './http.js';
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
  readonly limit?: number;
  readonly fetchFn?: FetchLike;
}

export interface ForwardingListenerOptions extends ListenerOptions {
  readonly forwardTo: string;
  readonly signingSecret: string;
  readonly now?: () => number;
}

export interface RunListenerOptions extends ForwardingListenerOptions {
  readonly pollIntervalMs: number;
  readonly once: boolean;
  readonly signal?: AbortSignal;
  readonly onStart?: (details: { signingSecret: string; cursor: string | null }) => void | Promise<void>;
  readonly onBatch?: (details: {
    delivered: number;
    cursor: string | null;
    hasMore: boolean;
  }) => void | Promise<void>;
}

export interface PollResult {
  readonly delivered: number;
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

export interface ListenPage {
  readonly data: ListenWebhookEventsResponse['data'];
  readonly cursor: string | null;
  readonly hasMore: boolean;
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
  };
}

export async function pollOnce(options: ForwardingListenerOptions): Promise<PollResult> {
  const page = await readListenPage(options);
  const fetchFn = options.fetchFn ?? fetch;
  for (const event of page.data) {
    await forwardEvent({
      eventId: event.id,
      payload: event.payload,
      forwardTo: options.forwardTo,
      signingSecret: options.signingSecret,
      fetchFn,
      now: options.now,
    });
  }

  return {
    delivered: page.data.length,
    cursor: page.cursor,
    hasMore: page.hasMore,
  };
}

export async function runListener(options: RunListenerOptions): Promise<PollResult> {
  let cursor = options.cursor ?? null;
  let delivered = 0;
  let hasMore = false;
  await options.onStart?.({ signingSecret: options.signingSecret, cursor });

  do {
    if (options.signal?.aborted) break;
    const result = await pollOnce({ ...options, cursor: cursor ?? undefined });
    delivered += result.delivered;
    cursor = result.cursor ?? cursor;
    hasMore = result.hasMore;
    await options.onBatch?.({ delivered: result.delivered, cursor, hasMore });

    if (options.once) break;
    if (!hasMore) {
      await sleep(options.pollIntervalMs, options.signal);
    }
  } while (!options.signal?.aborted);

  return { delivered, cursor, hasMore };
}

async function forwardEvent(input: {
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
