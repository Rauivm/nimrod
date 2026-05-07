const queue = [];
const MAX_QUEUE_SIZE = Number(process.env.NOTIFIER_QUEUE_MAX || 500);

let worker = null;
let scheduled = false;

export function registerNotifierWorker(fn) {
  worker = fn;
}

export function enqueueNotification(job) {
  if (!job || typeof job !== 'object') return false;
  if (queue.length >= MAX_QUEUE_SIZE) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[notifier] queue full; dropping notification');
    }
    return false;
  }

  queue.push({ ...job, attempts: 0 });
  scheduleNotifierDrain();
  return true;
}

export function scheduleNotifierDrain() {
  if (scheduled || !worker) return;
  scheduled = true;
  setTimeout(async () => {
    scheduled = false;
    await worker();
  }, 0).unref?.();
}

export function shiftNotification() {
  return queue.shift();
}

export function retryNotification(job, delayMs = 1000) {
  if (!job || queue.length >= MAX_QUEUE_SIZE) return;
  queue.push(job);
  setTimeout(scheduleNotifierDrain, delayMs).unref?.();
}

export function notifierQueueSize() {
  return queue.length;
}
