import assert from "node:assert/strict";
import { createWorkerPool } from "@/utils/workerPool";

class FakeWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string }) => void;
  onmessageerror?: () => void;
  sent: { id: number; value: number }[] = [];
  terminated = false;
  postMessage(message: { id: number; value: number }): void {
    if (message.value === -1) throw new Error("Clone failed");
    this.sent.push(message);
  }
  terminate(): void { this.terminated = true; }
  respond(data: object, id = this.sent.at(-1)!.id): void { this.onmessage?.({ data: { id, ...data } }); }
}
const workers: FakeWorker[] = [];
const pool = createWorkerPool<{ value: number }, number>(() => {
  const worker = new FakeWorker();
  workers.push(worker);
  return worker as unknown as Worker;
});
const affinity = {};
const progress: number[] = [];
const first = pool.run({ value: 1 }, { affinity, onProgress: count => progress.push(count) });
workers[0].respond({ type: "progress", completed: 3 });
workers[0].respond({ result: 10 });
assert.equal(await first, 10);
assert.deepEqual(progress, [3]);
await assert.rejects(pool.run({ value: -1 }, { affinity }), /Clone failed/);
const second = pool.run({ value: 2 }, { affinity });
assert.equal(workers.length, 1);
workers[0].respond({ error: "Invalid input" });
await assert.rejects(second, /Invalid input/);
const third = pool.run({ value: 3 }, { affinity });
workers[0].onerror?.({ message: "Crashed" });
await assert.rejects(third, /Crashed/);
assert(workers[0].terminated);
const fourth = pool.run({ value: 4 }, { affinity });
assert.equal(workers.length, 2);
workers[0].onerror?.({ message: "Late error from retired worker" });
workers[1].respond({ result: 40 });
assert.equal(await fourth, 40);
const fifth = pool.run({ value: 5 }, { affinity });
workers[1].onmessageerror?.();
await assert.rejects(fifth, /decode/);

const balancedWorkers: FakeWorker[] = [];
const balanced = createWorkerPool<{ value: number }, number>(() => {
  const worker = new FakeWorker();
  balancedWorkers.push(worker);
  return worker as unknown as Worker;
});
const tiles = Array.from({ length: balanced.size }, () => ({}));
for (const tile of tiles) {
  const result = balanced.run({ value: 1 }, { affinity: tile });
  balancedWorkers[0].respond({ result: 1 });
  assert.equal(await result, 1);
}
assert.equal(balancedWorkers.length, 1, "Idle affinity should reuse the worker");
const batch = tiles.map(affinity => balanced.run({ value: 2 }, { affinity }));
assert.equal(balancedWorkers.length, balanced.size, "Affinity must not queue work while other slots are idle");
for (const worker of balancedWorkers) worker.respond({ result: 2 });
assert.deepEqual(await Promise.all(batch), tiles.map(() => 2));

const queued = Promise.allSettled(Array.from({ length: balanced.size * 2 }, (_, value) => balanced.run({ value })));
balancedWorkers[0].onerror?.({ message: "Queued worker crashed" });
for (const worker of balancedWorkers.slice(1)) {
  for (const request of worker.sent.slice(-2).reverse()) worker.respond({ result: request.value }, request.id);
}
const settled = await queued;
assert.equal(settled.filter(result => result.status === "rejected").length, 2);
assert.equal(settled.filter(result => result.status === "fulfilled").length, (balanced.size - 1) * 2);

let attempts = 0;
const recoveredWorker = new FakeWorker();
const startup = createWorkerPool<{ value: number }, number>(() => {
  if (++attempts === 1) throw new Error("Worker construction blocked");
  return recoveredWorker as unknown as Worker;
});
await assert.rejects(startup.run({ value: 1 }), /construction blocked/);
const recovered = startup.run({ value: 2 });
recoveredWorker.respond({ result: 2 });
assert.equal(await recovered, 2);

const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
try {
  for (const [cores, size] of [[undefined, 2], [0, 2], [1, 2], [2, 2], [4, 3], [32, 4]] as const) {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: cores === undefined ? undefined : { hardwareConcurrency: cores } });
    const lazy = createWorkerPool(() => { throw new Error("Unused workers must not start"); });
    assert.equal(lazy.size, size);
  }
} finally {
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else Reflect.deleteProperty(globalThis, "navigator");
}
console.log("Worker pool: affinity, balancing, concurrency limits, lazy startup, progress, queued failures, clone errors and recovery passed.");
