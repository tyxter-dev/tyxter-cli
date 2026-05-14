export type FetchLike = typeof fetch;

export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
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
  throw new HttpStatusError(`${action} failed with HTTP ${response.status}`, response.status, body);
}
