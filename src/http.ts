export type FetchLike = typeof fetch;

export async function withRequestTimeout<T>(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => {
    controller.abort(new DOMException('API request timed out', 'TimeoutError'));
  }, timeoutMs);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  try {
    controller.signal.throwIfAborted();
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly action: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

export function endpointUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ''), normalizedBase);
}

export async function readFailure(response: Response, action: string): Promise<never> {
  const body = await response.text().catch(() => '');
  throw new HttpStatusError(
    `${action} failed with HTTP ${response.status}`,
    response.status,
    body,
    action,
    retryAfterMs(response, body),
  );
}

function retryAfterMs(response: Response, body: string): number | undefined {
  const headerMs = retryAfterHeaderMs(response.headers.get('retry-after'));
  if (headerMs !== undefined) return headerMs;
  return retryAfterBodyMs(body);
}

function retryAfterHeaderMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

function retryAfterBodyMs(body: string): number | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    const retryAfter = (parsed as { error?: { retry_after_ms?: unknown } }).error
      ?.retry_after_ms;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0) {
      return Math.ceil(retryAfter);
    }
  } catch {
    return undefined;
  }
  return undefined;
}
