import type { FetchLike } from './http.js';
import { pollOnce, readListenPage, type PollResult } from './listener.js';
import type { MessageResponse } from './schemas.js';
import { simulateInboundMessage } from './simulate.js';

export interface TourOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly forwardTo: string;
  readonly signingSecret: string;
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly cursor?: string;
  readonly traceId?: string;
  readonly idempotencyKey?: string;
  readonly pollAttempts: number;
  readonly pollIntervalMs: number;
  readonly fetchFn?: FetchLike;
  readonly now?: () => number;
  readonly onStep?: (message: string) => void;
}

export interface TourResult {
  readonly simulated: MessageResponse;
  readonly listen: PollResult;
  readonly attempts: number;
}

export async function runTour(options: TourOptions): Promise<TourResult> {
  let cursor = options.cursor ?? null;
  if (!cursor) {
    options.onStep?.('checkpoint listen cursor');
    cursor = await checkpointListenCursor(options);
  }

  options.onStep?.('simulate inbound');
  const simulated = await simulateInboundMessage({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    from: options.from,
    to: options.to,
    body: options.body,
    traceId: options.traceId,
    idempotencyKey: options.idempotencyKey,
    metadata: { source: 'webhook-listener-tour' },
    fetchFn: options.fetchFn,
  });

  let lastListen: PollResult = { delivered: 0, cursor, hasMore: false };
  for (let attempt = 1; attempt <= options.pollAttempts; attempt++) {
    options.onStep?.(`listen attempt ${attempt}`);
    lastListen = await pollOnce({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      forwardTo: options.forwardTo,
      signingSecret: options.signingSecret,
      eventType: 'message.received',
      limit: 100,
      cursor: cursor ?? undefined,
      fetchFn: options.fetchFn,
      now: options.now,
    });
    cursor = lastListen.cursor ?? cursor;
    if (lastListen.delivered > 0) {
      return { simulated, listen: lastListen, attempts: attempt };
    }
    if (attempt < options.pollAttempts) {
      await sleep(options.pollIntervalMs);
    }
  }

  throw new Error(
    `Tour did not receive a message.received webhook after ${options.pollAttempts} listen attempts.`,
  );
}

async function checkpointListenCursor(options: TourOptions): Promise<string | null> {
  let cursor: string | null = null;
  let hasMore = false;
  do {
    const page = await readListenPage({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
      eventType: 'message.received',
      limit: 100,
      cursor: cursor ?? undefined,
      fetchFn: options.fetchFn,
    });
    cursor = page.cursor ?? cursor;
    hasMore = page.hasMore;
  } while (hasMore);

  return cursor;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
