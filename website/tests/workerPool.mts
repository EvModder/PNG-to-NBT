import assert from "node:assert/strict";
import { createWorkerPool } from "@/utils/workerPool";
import { getTileBaseGeometry, getTileFinalGeometry } from "@/lib/tileGeometryWorkerClient";
import { analyzeBaseGeometry, analyzeFinalGeometry } from "@/lib/tileGeometry";
import type { TileBaseGeometryWorkerInput, TileFinalGeometryWorkerInput } from "@/lib/tileGeometryWorkerTypes";
import { computeColorGridStats, deriveImageStats, FlatModeBehavior } from "@/lib/colorGridAnalysis";
import { CRUBTECH_WATER_DROPS, resolveTileWaterSetting } from "@/lib/generationPolicy";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { Shade } from "@/types/color";

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
assert.equal(balancedWorkers.reduce((sum, worker) => sum + worker.sent.filter(request => request.id > balanced.size * 2).length, 0), balanced.size,
  "Only active requests are cloned and sent to workers");
const completed = new Set([balancedWorkers[0].sent.at(-1)!.id]);
balancedWorkers[0].onerror?.({ message: "Queued worker crashed" });
while (completed.size < balanced.size * 2) {
  for (const worker of balancedWorkers) {
    const request = worker.sent.at(-1)!;
    if (worker.terminated || completed.has(request.id)) continue;
    completed.add(request.id);
    worker.respond({ result: request.value }, request.id);
  }
}
const settled = await queued;
assert.equal(settled.filter(result => result.status === "rejected").length, 1);
assert.equal(settled.filter(result => result.status === "fulfilled").length, balanced.size * 2 - 1);

const abortWorkers: FakeWorker[] = [];
const abortPool = createWorkerPool<{ value: number }, number>(() => {
  const worker = new FakeWorker(); abortWorkers.push(worker); return worker as unknown as Worker;
});
const controller = new AbortController();
const abandoned = Promise.allSettled(Array.from({ length: 100 }, (_, value) => abortPool.run({ value }, { signal: controller.signal })));
assert.equal(abortWorkers.length, abortPool.size);
assert.equal(abortWorkers.reduce((sum, worker) => sum + worker.sent.length, 0), abortPool.size);
controller.abort();
assert((await abandoned).every(result => result.status === "rejected"));
assert(abortWorkers.every(worker => worker.terminated));
assert.equal(abortWorkers.length, abortPool.size, "Aborting a batch must not start its queued jobs");
await assert.rejects(abortPool.run({ value: 0 }, { signal: controller.signal }), /abort/i);
const afterAbort = abortPool.run({ value: 101 });
abortWorkers.at(-1)!.respond({ result: 101 });
assert.equal(await afterAbort, 101);

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

const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Worker");
const geometryWorkers: FakeWorker[] = [];
try {
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: class extends FakeWorker {
    constructor() { super(); geometryWorkers.push(this); }
  } });
  const input = {
    colorGrid: Array.from({ length: 128 }, () => Array.from({ length: 128 }, () => ({ id: 11, isCustom: false, shade: Shade.Flat }))),
    hasWater: false, hasTransparency: false, includeTransparentBlocks: false, waterSetting: undefined,
    flatModeBehavior: FlatModeBehavior.Plain, layerGap: 5, paletteSeed: 0, enableWaterConvenience: false,
    requiresTwoLayerLateShading: false, buildAtWorldMinY: false, buildMode: BuildMode.Flat, isFlatShape: true,
    suppress2LayerLatePairY: 6, useCrubTech: false, mixSteps: false, mixedStepMaxHeight: 0,
    skipEmptySuppressSteps: true, minSuppressStepOffset: 1, uniformSuppressStepSpacing: true,
    keepSuppressExtras: false, collapseStaircaseModes: true, includeFlatNorthline: false,
    selectedStepDirection: SuppressStepDirection.EastToWest, suppressCenterOut: false,
  } satisfies TileBaseGeometryWorkerInput & TileFinalGeometryWorkerInput;
  const result = { baseShapeMap: {}, baseNorthlineShape: null, isFlatShape: true,
    shapeMap: {}, northlineShape: null, supportShape: null, fillerNeedStats: null, northRowSingleLine: true };
  for (const varied of [false, true]) {
    const colorGrid = input.colorGrid.map(column => column.map((cell, z) => varied && z === 2 ? { ...cell, shade: Shade.Dark } : cell));
    const probe = { ...input, colorGrid, flatModeBehavior: varied ? FlatModeBehavior.None : FlatModeBehavior.Plain };
    const fast = await getTileBaseGeometry("probe", { ...probe, northlineOnly: true }, () => assert.fail("Unambiguous tiles need no discovery worker"));
    assert.equal(fast.isFlatShape, analyzeBaseGeometry(probe).isFlatShape);
  }
  // North boundary, contiguous slopes, isolated pixels and mixed void shading.
  for (const pattern of [0, 85, 170, 255, 13, 29, 53, 229]) {
    const colorGrid = input.colorGrid.map((column, x) => column.map((cell, z) => {
      const value = (pattern >>> (z * 2)) & 3;
      return { ...cell, id: x === 0 && z < 4 && value < 3 ? 11 : 0, shade: value % 3 };
    }));
    const probe = { ...input, colorGrid, hasTransparency: true, ...computeColorGridStats(colorGrid), northlineOnly: true };
    const expected = analyzeBaseGeometry(probe);
    let pending = false;
    const request = getTileBaseGeometry(`pattern:${pattern}`, probe, () => { pending = true; });
    if (pending) geometryWorkers.findLast(worker => !worker.terminated)!.respond({ result: expected });
    const actual = await request;
    assert.equal(actual.isFlatShape, expected.isFlatShape, `Flatness differs for pattern ${pattern}`);
    if (pending) assert.deepEqual(actual, expected);
  }
  for (const id of [0, 12]) {
    const colorGrid = input.colorGrid.map(column => column.map((cell, z) => ({ ...cell, id, isCustom: true, shade: z % 3 })));
    const probe = { ...input, colorGrid, flatModeBehavior: FlatModeBehavior.None, northlineOnly: true };
    const actual = await getTileBaseGeometry(`custom:${id}`, probe, () => assert.fail("Custom colors are land, not vanilla void/water"));
    assert.equal(actual.isFlatShape, analyzeBaseGeometry(probe).isFlatShape);
  }
  const waterGrid = input.colorGrid.map(column => column.map((cell, z) => ({ ...cell, id: 12, shade: z % 3 })));
  const waterProbe = { ...input, colorGrid: waterGrid, hasWater: true, flatModeBehavior: FlatModeBehavior.None, northlineOnly: true };
  const waterExpected = analyzeBaseGeometry(waterProbe);
  let waterPending = false;
  const waterRequest = getTileBaseGeometry("water-probe", waterProbe, () => { waterPending = true; });
  assert(waterPending, "Water shading must use geometry, not the dry height witness");
  geometryWorkers.findLast(worker => !worker.terminated)!.respond({ result: waterExpected });
  assert.deepEqual(await waterRequest, waterExpected);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(getTileBaseGeometry("aborted-probe", { ...input, northlineOnly: true },
    () => assert.fail("Cancelled shortcuts must not start work"), aborted.signal), /abort/i);
  for (const get of [getTileBaseGeometry, getTileFinalGeometry]) {
    let pending = 0;
    const onPending = () => ++pending;
    const a = get("tile", input, onPending);
    const b = get("tile", input, onPending);
    assert.equal(a, b, "Identical in-flight requests share one promise");
    assert.equal(pending, 2, "Each waiting caller receives a pending notification");
    geometryWorkers[0].respond({ result });
    assert.equal(await a, result);
    assert.equal(await get("tile", input, onPending), result);
    assert.equal(pending, 2, "Cache hits never report pending work");
    assert.equal(await get("tile", { ...input, layerGap: 17 }, onPending), result);
    assert.equal(await get("tile", { ...input, enableWaterConvenience: true }, onPending), result);
    assert.equal(pending, 2, "Inactive settings preserve cache hits");

    const failed = get("retry", input, onPending);
    geometryWorkers[0].respond({ error: "Retryable" });
    await assert.rejects(failed, /Retryable/);
    const retry = get("retry", input, onPending);
    geometryWorkers[0].respond({ result });
    assert.equal(await retry, result, "Failures must not poison the in-flight cache");

    // Fill the cache, refresh an old key, then verify least-recent eviction.
    for (let i = 0; i < 4094; ++i) {
      const request = get(String(i), input, onPending);
      geometryWorkers[0].respond({ result });
      await request;
    }
    await get("tile", input, onPending);
    const overflow = get("overflow", input, onPending);
    geometryWorkers[0].respond({ result });
    await overflow;
    const before = pending;
    await get("tile", input, onPending);
    assert.equal(pending, before, "A refreshed entry survives eviction");
    const evicted = get("retry", input, onPending);
    assert.equal(pending, before + 1);
    geometryWorkers[0].respond({ result });
    await evicted;
  }
  const respond = (result: object) => geometryWorkers.findLast(worker => !worker.terminated)!.respond({ result });
  const northline = getTileBaseGeometry("northline-seed", waterProbe, () => {});
  respond(waterExpected); await northline;
  assert.equal(await getTileBaseGeometry("northline-seed", { ...waterProbe, paletteSeed: 9 },
    () => assert.fail("Northline does not use a palette seed")), waterExpected);
  for (const shade of [Shade.Dark, Shade.Flat, Shade.Light]) {
    const colorGrid = input.colorGrid.map((column, x) => column.map((cell, z) => ({ ...cell,
      id: x > 1 || z > 1 ? 0 : x === 0 ? 12 : 11, shade })));
    const stats = computeColorGridStats(colorGrid);
    const derived = deriveImageStats(stats);
    const drops = [3, 2, 1] as const;
    const changed = drops.map((drop, i) => i === shade ? drop : drop + 10) as [number, number, number];
    for (const crubTech of [false, true]) {
      const mode = crubTech ? BuildMode.Suppress2Layer : BuildMode.StaircaseNorthline;
      const waterSetting = resolveTileWaterSetting(derived, mode, true, crubTech, false, drops);
      assert.deepEqual(waterSetting, resolveTileWaterSetting(derived, mode, true, crubTech, false, changed));
      const probe = { ...input, colorGrid, hasWater: true, waterSetting, buildMode: mode, collapseStaircaseModes: false };
      assert.deepEqual(analyzeFinalGeometry(probe), analyzeFinalGeometry({ ...probe,
        colorGrid: structuredClone(colorGrid), waterSetting: { kind: "below-platform",
          drops: crubTech ? CRUBTECH_WATER_DROPS.map(drop => drop + 1) as [number, number, number] : drops } }));
    }
  }
  for (const buildMode of [BuildMode.StaircaseNorthline, BuildMode.StaircaseParty]) {
    const probe = { ...input, buildMode, collapseStaircaseModes: false };
    const expected = analyzeFinalGeometry(probe);
    const first = getTileFinalGeometry(`seed:${buildMode}`, probe, () => {});
    respond(expected); await first;
    let pending = false;
    const next = getTileFinalGeometry(`seed:${buildMode}`, { ...probe, paletteSeed: 9 }, () => { pending = true; });
    assert.equal(pending, buildMode === BuildMode.StaircaseParty);
    if (pending) respond(expected);
    await next;
    assert.equal(analyzeFinalGeometry({ ...probe, enableWaterConvenience: true }).shapeMap[buildMode], expected.shapeMap[buildMode],
      "Dry geometry must reuse its inner shape cache");
  }
  for (const waterSetting of [{ kind: "top-aligned" }, { kind: "below-platform", drops: [3, 2, 1] }] as const) {
    const colorGrid = input.colorGrid.map(column => column.map(cell => ({ ...cell, id: 12 })));
    const probe = { ...input, colorGrid, hasWater: true, waterSetting };
    for (const [get, analyze] of [[getTileBaseGeometry, analyzeBaseGeometry], [getTileFinalGeometry, analyzeFinalGeometry]] as const) {
      const expected = analyze(probe);
      const equivalent = analyze({ ...probe, enableWaterConvenience: true });
      assert.deepEqual(equivalent, expected);
      const before = "baseShapeMap" in expected ? expected.baseShapeMap : expected.shapeMap;
      const after = "baseShapeMap" in equivalent ? equivalent.baseShapeMap : equivalent.shapeMap;
      for (const mode of Object.keys(before) as BuildMode[]) assert.equal(after[mode], before[mode], "Inner geometry must also be reused");
      const first = get(`explicit:${waterSetting.kind}`, probe, () => {});
      respond(expected);
      await first;
      assert.deepEqual(await get(`explicit:${waterSetting.kind}`, { ...probe, enableWaterConvenience: true },
        () => assert.fail("Explicit water placements bypass convenience")), expected);
    }
  }
  for (const get of [getTileBaseGeometry, getTileFinalGeometry]) {
    let pending = 0;
    for (const enableWaterConvenience of [false, true]) {
      const wet = get("wet", { ...input, hasWater: true, enableWaterConvenience }, () => ++pending);
      respond(result);
      await wet;
    }
    assert.equal(pending, 2, "Water convenience must not alias when it can change placements");
  }
  const a = new AbortController(), b = new AbortController();
  const sharedA = getTileFinalGeometry("shared-abort", input, () => {}, a.signal);
  const sharedB = getTileFinalGeometry("shared-abort", input, () => {}, b.signal);
  a.abort();
  await assert.rejects(sharedA, /abort/i);
  respond(result);
  assert.equal(await sharedB, result, "One subscriber cannot cancel another's shared request");
  const old = new AbortController();
  const cancelled = getTileFinalGeometry("replace-abort", input, () => {}, old.signal);
  old.abort();
  const replacement = getTileFinalGeometry("replace-abort", input, () => {});
  await assert.rejects(cancelled, /abort/i);
  assert.equal(getTileFinalGeometry("replace-abort", input, () => {}), replacement, "Old cleanup must not remove a replacement request");
  respond(result);
  assert.equal(await replacement, result);

  // Model a large cell map without allocating hundreds of thousands of test objects.
  const cells = new Map();
  Object.defineProperty(cells, "size", { value: 600_000 });
  const large = { shapeMap: { [BuildMode.Flat]: { parts: [{ cells }] } }, northlineShape: null, supportShape: null, fillerNeedStats: null, northRowSingleLine: true };
  const displayedRequest = getTileFinalGeometry("large-a", input, () => {});
  respond(large);
  const displayed = await displayedRequest;
  const other = getTileFinalGeometry("large-b", input, () => {});
  respond({ ...large, shapeMap: { ...large.shapeMap } }); await other;
  const hitOnly = () => { throw new Error("Displayed geometry must not start another worker job"); };
  assert.equal(await getTileFinalGeometry("large-a", input, hitOnly, undefined, displayed.shapeMap), displayed);
  const changed = getTileFinalGeometry("large-a", { ...input, buildAtWorldMinY: true }, () => {}, undefined, displayed.shapeMap);
  respond(result);
  assert.notEqual(await changed, displayed, "A live result cannot mask a different settings key");
  let missed = false;
  const evictedLarge = getTileFinalGeometry("large-a", input, () => { missed = true; });
  assert(missed, "Cell budget must evict dense results long before the entry limit");
  respond(result); await evictedLarge;
  console.log("Geometry cache sharing, cancellation, retry and bounded eviction passed.");
} finally {
  if (workerDescriptor) Object.defineProperty(globalThis, "Worker", workerDescriptor);
  else Reflect.deleteProperty(globalThis, "Worker");
}
