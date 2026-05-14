import { readListenPage, type ListenerOptions } from './listener.js';

export interface CheckpointOptions extends ListenerOptions {
  readonly onPage?: (details: CheckpointPageDetails) => void | Promise<void>;
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
  let hasMore = false;

  do {
    const page = await readListenPage({
      ...options,
      cursor: cursor ?? undefined,
    });
    pages += 1;
    skipped += page.data.length;
    cursor = page.cursor ?? cursor;
    hasMore = page.hasMore;
    await options.onPage?.({
      skipped: page.data.length,
      cursor,
      hasMore,
    });
  } while (hasMore);

  return { cursor, pages, skipped };
}
