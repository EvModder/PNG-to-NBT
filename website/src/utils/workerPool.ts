/**
 * Public API:
 * - createWorkerPool()
 *
 * Callers: src/lib/tileGeometryWorkerClient.ts, src/lib/tileParsingWorkerClient.ts
 */
export function createWorkerPool<Request, Result>(createWorker: () => Worker) {
  type Options = { transfer?: Transferable[]; affinity?: object; onProgress?: (completed: number) => void; signal?: AbortSignal };
  type Job = { id: number; request: Request; options: Options; resolve: (result: Result) => void; reject: (error: unknown) => void; abort: () => void; slot?: Slot };
  type Slot = { worker?: Worker; job?: Job };
  const concurrency = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  const slots: Slot[] = Array.from({ length: Math.max(2, Math.min(4, concurrency - 1)) }, () => ({}));
  const affinity = new WeakMap<object, Slot>();
  const queue = new Map<number, Job>();
  let nextId = 0;
  let draining = false;

  function finish(job: Job): void {
    queue.delete(job.id);
    job.options.signal?.removeEventListener("abort", job.abort);
    if (job.slot) job.slot.job = undefined;
  }

  function start(slot: Slot): Worker {
    if (slot.worker) return slot.worker;
    const worker = slot.worker = createWorker();
    const fail = (error: unknown) => {
      if (slot.worker !== worker) return;
      worker.terminate();
      slot.worker = undefined;
      const job = slot.job;
      if (job) { finish(job); job.reject(error); }
      drain();
    };
    worker.onerror = event => {
      event.preventDefault?.();
      fail(event.error ?? new Error(event.message || "Worker crashed"));
    };
    worker.onmessageerror = () => fail(new Error("Unable to decode worker response"));
    worker.onmessage = (event: MessageEvent<
      { id: number; error: string } | { id: number; type: "progress"; completed: number } | { id: number; result: Result }
    >) => {
      const message = event.data;
      const job = slot.job;
      if (slot.worker !== worker || !job || job.id !== message.id) return;
      if ("error" in message) { finish(job); job.reject(new Error(message.error)); }
      else if ("result" in message) { finish(job); job.resolve(message.result); }
      else { job.options.onProgress?.(message.completed); return; }
      drain();
    };
    return worker;
  }

  function drain(): void {
    if (draining) return;
    draining = true;
    try {
      while (queue.size) {
        const job = queue.values().next().value!;
        if (job.options.signal?.aborted) {
          finish(job);
          job.reject(job.options.signal.reason);
          continue;
        }
        const preferred = job.options.affinity && affinity.get(job.options.affinity);
        const slot = preferred && !preferred.job ? preferred : slots.find(slot => !slot.job);
        if (!slot) break;
        queue.delete(job.id);
        job.slot = slot;
        slot.job = job;
        if (job.options.affinity) affinity.set(job.options.affinity, slot);
        try {
          start(slot).postMessage({ ...job.request, id: job.id }, job.options.transfer ?? []);
        } catch (error) { finish(job); job.reject(error); }
      }
    } finally { draining = false; }
  }

  return {
    size: slots.length,
    run(request: Request, options: Options = {}): Promise<Result> {
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      return new Promise((resolve, reject) => {
        const job: Job = { id: ++nextId, request, options, resolve, reject, abort: () => {
          // Synchronous generation cannot observe an abort message until it finishes.
          if (job.slot) { job.slot.worker?.terminate(); job.slot.worker = undefined; }
          finish(job);
          reject(options.signal!.reason);
          // Let all subscribers of the same cancelled UI operation abort first.
          if (job.slot && queue.size) queueMicrotask(drain);
        } };
        options.signal?.addEventListener("abort", job.abort, { once: true });
        // Keep requests on this side until a slot is free, avoiding queued structured clones.
        queue.set(job.id, job);
        if (queue.size === 1) drain();
      });
    },
  };
}
