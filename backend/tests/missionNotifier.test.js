import { afterEach, describe, it, expect, vi } from 'vitest';
import { configureEmailTransport, emailAvailable, deliverEmail } from '../src/services/notifier/email.js';
afterEach(() => {
  configureEmailTransport(null);
  vi.useRealTimers();
});
describe('Mission notifications', () => {
  it('never reports an email sent without a real configured transport', async () => {
    expect(emailAvailable()).toBe(false);
    await expect(deliverEmail({
      to: 'synthetic@example.test'
    })).rejects.toMatchObject({
      code: 'EMAIL_UNAVAILABLE'
    });
    const provider = vi.fn().mockRejectedValue(new Error('Temporary failure'));
    configureEmailTransport(provider);
    await expect(deliverEmail({
      to: 'synthetic@example.test'
    })).rejects.toThrow('Temporary failure');
    expect(provider).toHaveBeenCalledOnce();
  });
  it('waits for the retry delay before putting a failed notification back in the worker', async () => {
    vi.useFakeTimers();
    const queue = await import('../src/services/notifier/queue.js');
    const received = [];
    queue.registerNotifierWorker(async () => {
      let job;
      while (job = queue.shiftNotification()) received.push(job);
    });
    queue.enqueueNotification({
      type: 'synthetic'
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(received.length).toBe(1);
    queue.retryNotification(received[0], 500);
    await vi.advanceTimersByTimeAsync(499);
    expect(received.length).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(received.length).toBe(2);
  });
});
