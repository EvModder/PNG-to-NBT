/**
 * Public API:
 * - createWorkerPool()
 *
 * Callers: src/lib/tileGeometryWorkerClient.ts, src/lib/tileParsingWorkerClient.ts
 */
export function createWorkerPool<Request, Result>(createWorker: () => Worker) {
  type Slot = { worker?: Worker; pending: number };
  type Pending = { slot: Slot; resolve: (result: Result) => void; reject: (error: unknown) => void; onProgress?: (completed: number) => void };
  const concurrency = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  const slots: Slot[] = Array.from({ length: Math.max(2, Math.min(4, concurrency - 1 || 2)) }, () => ({ pending: 0 }));
  const affinity = new WeakMap<object, Slot>();
  const pending = new Map<number, Pending>();
  let nextId = 0;

  function finish(id: number): Pending | undefined {
    const job = pending.get(id);
    if (job) { pending.delete(id); --job.slot.pending; }
    return job;
  }

  function start(slot: Slot): Worker {
    if (slot.worker) return slot.worker;
    const worker = slot.worker = createWorker();
    const fail = (error: unknown) => {
      if (slot.worker !== worker) return;
      worker.terminate();
      slot.worker = undefined;
      for (const [id, job] of pending) if (job.slot === slot) finish(id)?.reject(error);
    };
    worker.onerror = event => fail(event.error ?? new Error(event.message || "Worker crashed"));
    worker.onmessageerror = () => fail(new Error("Unable to decode worker response"));
    worker.onmessage = (event: MessageEvent<
      { id: number; error: string } | { id: number; type: "progress"; completed: number } | { id: number; result: Result }
    >) => {
      const message = event.data;
      if ("error" in message) finish(message.id)?.reject(new Error(message.error));
      else if ("result" in message) finish(message.id)?.resolve(message.result);
      else pending.get(message.id)?.onProgress?.(message.completed);
    };
    return worker;
  }

  return {
    size: slots.length,
    run(request: Request, options: { transfer?: Transferable[]; affinity?: object; onProgress?: (completed: number) => void } = {}): Promise<Result> {
      const leastBusy = slots.reduce((a, b) => a.pending <= b.pending ? a : b);
      const preferred = options.affinity && affinity.get(options.affinity);
      // Reuse cached work without piling requests onto a busier worker.
      const slot = preferred && preferred.pending === leastBusy.pending ? preferred : leastBusy;
      if (options.affinity) affinity.set(options.affinity, slot);
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        try {
          const worker = start(slot);
          ++slot.pending;
          pending.set(id, { slot, resolve, reject, onProgress: options.onProgress });
          worker.postMessage({ ...request, id }, options.transfer ?? []);
        } catch (error) {
          finish(id);
          reject(error);
        }
      });
    },
  };
}
