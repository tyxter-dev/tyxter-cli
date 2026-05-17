import { z } from 'zod';

export const ListenWebhookEventSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    source_id: z.string().optional(),
    trace_id: z.string().optional(),
    created_at: z.string().optional(),
    payload: z.unknown(),
  })
  .passthrough();

export const WebhookDeliveryAttemptSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    attempt: z.number().int(),
    status_code: z.number().int().nullable().optional(),
    response_body_redacted: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
    next_retry_at: z.string().nullable().optional(),
    created_at: z.string(),
  })
  .passthrough();

export const WebhookEventLogSchema = z
  .object({
    id: z.string(),
    object: z.literal('webhook_event'),
    endpoint_id: z.string().nullable(),
    type: z.string(),
    source_type: z.string(),
    source_id: z.string(),
    payload: z.unknown(),
    status: z.string(),
    trace_id: z.string(),
    created_at: z.string(),
    attempts: z.array(WebhookDeliveryAttemptSchema),
  })
  .passthrough();

export type WebhookEventLog = z.infer<typeof WebhookEventLogSchema>;

export const ListenWebhookEventEnvelopeSchema = z.union([
  WebhookEventLogSchema,
  ListenWebhookEventSchema,
]);

export const ListenWebhookEventsResponseSchema = z.object({
  object: z.literal('webhook_event_listen'),
  data: z.array(ListenWebhookEventEnvelopeSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
  next_poll_after_ms: z.number().int().min(0).optional(),
});

export type ListenWebhookEventsResponse = z.infer<typeof ListenWebhookEventsResponseSchema>;

export const ListWebhookEventsResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(WebhookEventLogSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
});

export type ListWebhookEventsResponse = z.infer<typeof ListWebhookEventsResponseSchema>;

export const InboundSandboxMessageRequestSchema = z.object({
  channel: z.enum(['whatsapp', 'instagram']).optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.literal('text'),
  text: z.object({
    body: z.string().min(1),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type InboundSandboxMessageRequest = z.infer<typeof InboundSandboxMessageRequestSchema>;

export const MessageResponseSchema = z
  .object({
    id: z.string(),
    object: z.literal('message'),
    status: z.string(),
    environment: z.string(),
    created_at: z.string(),
    trace_id: z.string(),
  })
  .passthrough();

export type MessageResponse = z.infer<typeof MessageResponseSchema>;
