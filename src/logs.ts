import { endpointUrl, type FetchLike, readFailure } from './http.js';
import {
  ListWebhookEventsResponseSchema,
  type ListWebhookEventsResponse,
  type WebhookEventLog,
} from './schemas.js';

export interface WebhookEventListOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly eventType?: string;
  readonly eventTypes?: readonly string[];
  readonly status?: 'pending' | 'delivered' | 'failed';
  readonly limit?: number;
  readonly startingAfter?: string;
  readonly fetchFn?: FetchLike;
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

  const response = await fetchFn(url, {
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: 'application/json',
    },
  });
  if (!response.ok) await readFailure(response, 'webhook events list');
  return ListWebhookEventsResponseSchema.parse(await response.json());
}

export async function tailWebhookLogs(
  options: TailWebhookLogsOptions,
): Promise<TailWebhookLogsResult> {
  const seen = new Set<string>();
  let emitted = 0;
  const initialLimit = options.last > 0 ? options.last : 100;
  const initial = await readWebhookEventsPage({ ...options, limit: initialLimit });
  for (const event of initial.data) seen.add(event.id);

  if (options.last > 0) {
    for (const event of [...initial.data].reverse()) {
      await options.onEvent?.(event);
      emitted += 1;
    }
  }

  while (!options.signal?.aborted) {
    await sleepWithOptions(options, options.pollIntervalMs);
    if (options.signal?.aborted) break;

    const page = await readWebhookEventsPage({ ...options, limit: 100 });
    const next = page.data.filter((event) => !seen.has(event.id)).reverse();
    for (const event of page.data) seen.add(event.id);
    for (const event of next) {
      await options.onEvent?.(event);
      emitted += 1;
    }
  }

  return { emitted };
}

function sleepWithOptions(
  options: TailWebhookLogsOptions,
  ms: number,
): Promise<void> {
  return (options.sleep ?? sleep)(Math.max(0, Math.ceil(ms)), options.signal);
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
