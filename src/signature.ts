import { createHmac, timingSafeEqual } from 'node:crypto';

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyWebhookSignature(input: {
  readonly secret: string;
  readonly timestamp: string;
  readonly rawBody: string;
  readonly signature: string;
  readonly toleranceSeconds?: number;
  readonly now?: () => number;
}): boolean {
  if (!input.secret || !input.timestamp || !input.signature) return false;
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((input.now?.() ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) return false;

  const expected = signWebhook(input.secret, input.timestamp, input.rawBody);
  if (expected.length !== input.signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(input.signature));
}
