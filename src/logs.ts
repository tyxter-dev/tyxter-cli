import { setTimeout as delay } from 'node:timers/promises';

import { endpointUrl, HttpStatusError, type FetchLike, readFailure, withRequestTimeout } from './http.js';
import {
  ListWebhookEventsResponseSchema,
  type ListWebhookEventsResponse,
  type WebhookEventLog,
} from './schemas.js';

const PAGE_LIMIT = 100;

export interface WebhookEventListOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly eventType?: string;
  readonly eventTypes?: readonly string[];
  readonly status?: 'pending' | 'delivered' | 'failed';
  readonly limit?: number;
  readonly startingAfter?: string;
  readonly fetchFn?: FetchLike;
  readonly signal?: AbortSignal;
  readonly requestTimeoutMs?: number;
}

export interface TailWebhookLogsOptions extends WebhookEventListOptions {
  readonly last: number;
  readonly pollIntervalMs: number;
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: WebhookEventLog) => void | Promise<void>;
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

export interface TailWebhookLogsResult {
  readonly emitted: number;
}

export async function readWebhookEventsPage(
  options: WebhookEventListOptions,
): Promise<ListWebhookEventsResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const url = endpointUrl(options.apiUrl, '/v1/webhook-events');
  url.searchParams.set('limit', String(options.limit ?? 20));
  if (options.startingAfter) url.searchParams.set('starting_after', options.startingAfter);
  if (options.eventType) url.searchParams.set('event_type', options.eventType);
  if (options.eventTypes && options.eventTypes.length > 0) {
    url.searchParams.set('event_types', options.eventTypes.join(','));
  }
  if (options.status) url.searchParams.set('status', options.status);

  return withRequestTimeout(options.signal, options.requestTimeoutMs ?? 30_000, async (signal) => {
    const response = await fetchFn(url, {
      signal,
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: 'application/json',
      },
    });
    if (!response.ok) await readFailure(response, 'webhook events list');
    return ListWebhookEventsResponseSchema.parse(await response.json());
  });
}

export async function tailWebhookLogs(
  options: TailWebhookLogsOptions,
): Promise<TailWebhookLogsResult> {
  let seen = new Set<string>();
  let emitted = 0;

  // Status membership can change anywhere in creation-ordered history. Seed and
  // rescan that whole snapshot; an overlap boundary is only safe without status.
  async function snapshot(initial: boolean): Promise<{ events: WebhookEventLog[]; ids: Set<string> }> {
    const events: WebhookEventLog[] = [];
    const ids = new Set<string>();
    const cursors = new Set<string>();
    let startingAfter = options.startingAfter;
    let firstPage = true;
    while (!options.signal?.aborted) {
      let page: ListWebhookEventsResponse;
      try {
        page = await readWebhookEventsPage({ ...options, limit: PAGE_LIMIT, startingAfter });
      } catch (error) {
        if (!(error instanceof HttpStatusError) || error.status !== 429) throw error;
        await sleepWithOptions(options, error.retryAfterMs ?? options.pollIntervalMs);
        continue;
      }
      for (const event of page.data) {
        if (initial) {
          if (firstPage && events.length < options.last) events.push(event);
        } else if (!seen.has(event.id) && !ids.has(event.id)) {
          events.push(event);
        }
        if (options.status || firstPage) ids.add(event.id);
      }
      if (!page.has_more) break;
      if (!options.status && (initial || page.data.some((event) => seen.has(event.id)))) break;
      if (!page.next_cursor || page.next_cursor === startingAfter || cursors.has(page.next_cursor)) {
        throw new Error('Webhook events list pagination did not advance.');
      }
      cursors.add(page.next_cursor);
      startingAfter = page.next_cursor;
      firstPage = false;
    }
    return { events, ids };
  }

  try {
    let current = await snapshot(true);
    while (!options.signal?.aborted) {
      for (const event of current.events.reverse()) {
        if (options.signal?.aborted) break;
        await options.onEvent?.(event);
        emitted += 1;
      }
      // Keep the current snapshot, not every id observed during the process lifetime.
      seen = current.ids;
      await sleepWithOptions(options, options.pollIntervalMs);
      if (options.signal?.aborted) break;
      current = await snapshot(false);
    }
  } catch (error) {
    if (!options.signal?.aborted) throw error;
  }
  return { emitted };
}

function sleepWithOptions(options: TailWebhookLogsOptions, ms: number): Promise<void> {
  return (options.sleep ?? sleep)(Math.max(0, Math.ceil(ms)), options.signal);
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal?.aborted) throw error;
  }
}
