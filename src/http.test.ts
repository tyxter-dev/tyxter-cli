import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';

import { withRequestTimeout } from './http.js';

describe('request deadlines', () => {
  it('removes parent abort handlers after success and failure', async () => {
    const controller = new AbortController();
    for (let i = 0; i < 20; i++) {
      await withRequestTimeout(controller.signal, 100, async () => 'ok');
    }
    await expect(withRequestTimeout(controller.signal, 100, async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('bounds pending requests and propagates cancellation', async () => {
    const pending = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    await expect(withRequestTimeout(undefined, 10, pending)).rejects.toMatchObject({ name: 'TimeoutError' });
    const controller = new AbortController();
    const request = withRequestTimeout(controller.signal, 1000, pending);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});
