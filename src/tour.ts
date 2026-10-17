import { HttpStatusError, type FetchLike } from './http.js';
import { checkpointListenCursor } from './checkpoint.js';
import { pollOnce, type PollResult } from './listener.js';
import type { MessageResponse } from './schemas.js';
import { simulateInboundMessage } from './simulate.js';

export interface TourOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly forwardTo: string;
  readonly signingSecret: string;
  readonly channel?: 'whatsapp' | 'instagram';
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
  readonly sleep?: (ms: number) => Promise<void>;
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
    cursor = (
      await checkpointListenCursor({
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        eventType: 'message.received',
        limit: 100,
        fetchFn: options.fetchFn,
      })
    ).cursor;
  }

  options.onStep?.('simulate inbound');
  const simulated = await simulateInboundMessage({
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    channel: options.channel,
    from: options.from,
    to: options.to,
    body: options.body,
    traceId: options.traceId,
    idempotencyKey: options.idempotencyKey,
    metadata: { source: 'tyxter-cli-tour' },
    fetchFn: options.fetchFn,
  });

  let lastListen: PollResult = { delivered: 0, eventIds: [], cursor, hasMore: false };
  let retryDelayMs = Math.min(30_000, options.pollIntervalMs);
  for (let attempt = 1; attempt <= options.pollAttempts;) {
    options.onStep?.(`listen attempt ${attempt}`);
    try {
      lastListen = await pollOnce({
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        forwardTo: options.forwardTo,
        signingSecret: options.signingSecret,
        eventType: 'message.received',
        limit: 100,
        cursor: cursor ?? undefined,
        shouldForward: (event) => event.source_id === simulated.id,
        fetchFn: options.fetchFn,
        now: options.now,
      });
    } catch (error) {
      if (
        !(error instanceof HttpStatusError) ||
        error.status !== 429 ||
        error.action !== 'webhook event listen'
      ) throw error;
      await (options.sleep ?? sleep)(error.retryAfterMs ?? retryDelayMs);
      retryDelayMs = Math.min(30_000, retryDelayMs * 2);
      continue;
    }
    retryDelayMs = Math.min(30_000, options.pollIntervalMs);
    cursor = lastListen.cursor ?? cursor;
    if (lastListen.delivered > 0) {
      return { simulated, listen: lastListen, attempts: attempt };
    }
    if (attempt < options.pollAttempts) {
      await (options.sleep ?? sleep)(Math.max(
        options.pollIntervalMs, lastListen.nextPollAfterMs ?? 0,
      ));
    }
    attempt += 1;
  }

  throw new Error(
    `Tour did not receive a message.received webhook after ${options.pollAttempts} listen attempts.`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
