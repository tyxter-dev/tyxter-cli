import { endpointUrl, type FetchLike, readFailure } from './http.js';
import {
  InboundSandboxMessageRequestSchema,
  MessageResponseSchema,
  type InboundSandboxMessageRequest,
  type MessageResponse,
} from './schemas.js';

export interface SimulateInboundOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly from: string;
  readonly to: string;
  readonly body: string;
  readonly traceId?: string;
  readonly idempotencyKey?: string;
  readonly metadata?: Record<string, unknown>;
  readonly fetchFn?: FetchLike;
}

export async function simulateInboundMessage(
  options: SimulateInboundOptions,
): Promise<MessageResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const request: InboundSandboxMessageRequest = {
    from: options.from,
    to: options.to,
    type: 'text',
    text: { body: options.body },
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
  const payload = InboundSandboxMessageRequestSchema.parse(request);
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.apiKey}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (options.traceId) headers['tyxter-trace-id'] = options.traceId;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetchFn(endpointUrl(options.apiUrl, '/v1/sandbox/inbound-messages'), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) await readFailure(response, 'sandbox inbound simulation');

  return MessageResponseSchema.parse(await response.json());
}
