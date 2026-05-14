import { endpointUrl, type FetchLike, readFailure } from './http.js';
import { forwardEvent } from './listener.js';
import { WebhookEventLogSchema, type WebhookEventLog } from './schemas.js';

export interface ResendListenEventOptions {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly eventId: string;
  readonly forwardTo: string;
  readonly signingSecret: string;
  readonly fetchFn?: FetchLike;
  readonly now?: () => number;
}

export interface ResendListenEventResult {
  readonly object: 'tyxter_cli_event_resend';
  readonly event_id: string;
  readonly payload_id: string | null;
  readonly type: string;
  readonly source_id: string;
  readonly trace_id: string;
  readonly forward_to: string;
  readonly forwarded: true;
}

export async function retrieveListenEvent(options: {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly eventId: string;
  readonly fetchFn?: FetchLike;
}): Promise<WebhookEventLog> {
  const fetchFn = options.fetchFn ?? fetch;
  const listenEventId = normalizeListenEventId(options.eventId);
  const response = await fetchFn(
    endpointUrl(
      options.apiUrl,
      `/v1/webhook-events/listen/${encodeURIComponent(listenEventId)}`,
    ),
    {
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        accept: 'application/json',
      },
    },
  );
  if (!response.ok) await readFailure(response, 'webhook listen event retrieve');
  return WebhookEventLogSchema.parse(await response.json());
}

export async function resendListenEvent(
  options: ResendListenEventOptions,
): Promise<ResendListenEventResult> {
  const event = await retrieveListenEvent(options);
  await forwardEvent({
    eventId: event.id,
    payload: event.payload,
    forwardTo: options.forwardTo,
    signingSecret: options.signingSecret,
    fetchFn: options.fetchFn ?? fetch,
    now: options.now,
  });

  return {
    object: 'tyxter_cli_event_resend',
    event_id: event.id,
    payload_id: payloadId(event.payload),
    type: event.type,
    source_id: event.source_id,
    trace_id: event.trace_id,
    forward_to: options.forwardTo,
    forwarded: true,
  };
}

export function normalizeListenEventId(eventId: string): string {
  return eventId.startsWith('evt_') ? eventId.slice(4) : eventId;
}

function payloadId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === 'string' ? id : null;
}
