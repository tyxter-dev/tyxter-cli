import { z } from 'zod';

export const ListenWebhookEventSchema = z
  .object({
    id: z.string(),
    payload: z.unknown(),
  })
  .passthrough();

export const ListenWebhookEventsResponseSchema = z.object({
  object: z.literal('webhook_event_listen'),
  data: z.array(ListenWebhookEventSchema),
  has_more: z.boolean(),
  next_cursor: z.string().nullable(),
  next_poll_after_ms: z.number().int().min(0).optional(),
});

export type ListenWebhookEventsResponse = z.infer<typeof ListenWebhookEventsResponseSchema>;

export const InboundSandboxMessageRequestSchema = z.object({
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
