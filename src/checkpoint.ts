import { setTimeout as delay } from 'node:timers/promises';

import { HttpStatusError } from './http.js';
import { readListenPage, type ListenPage, type ListenerOptions } from './listener.js';

export interface CheckpointOptions extends ListenerOptions {
  readonly onPage?: (details: CheckpointPageDetails) => void | Promise<void>;
  readonly sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

export interface CheckpointPageDetails {
  readonly skipped: number;
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

export interface CheckpointResult {
  readonly cursor: string | null;
  readonly pages: number;
  readonly skipped: number;
}

export async function checkpointListenCursor(
  options: CheckpointOptions,
): Promise<CheckpointResult> {
  let cursor = options.cursor ?? null;
  let pages = 0;
  let skipped = 0;
  let retryDelayMs = 1_000;

  while (true) {
    options.signal?.throwIfAborted();
    let page: ListenPage;
    try {
      page = await readListenPage({
        ...options,
        cursor: cursor ?? undefined,
      });
    } catch (error) {
      if (!(error instanceof HttpStatusError) || error.status !== 429) throw error;
      await (options.sleep ?? sleep)(error.retryAfterMs ?? retryDelayMs, options.signal);
      retryDelayMs = Math.min(30_000, retryDelayMs * 2);
      continue;
    }
    retryDelayMs = 1_000;
    pages += 1;
    skipped += page.data.length;
    cursor = page.cursor ?? cursor;
    const hasMore = page.hasMore;
    await options.onPage?.({
      skipped: page.data.length,
      cursor,
      hasMore,
    });
    if (!hasMore) break;
  }

  return { cursor, pages, skipped };
}

async function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  await delay(ms, undefined, { signal });
}
