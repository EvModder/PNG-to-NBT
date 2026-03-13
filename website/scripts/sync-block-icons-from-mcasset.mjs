#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { blockIdOnly, mapLegacyBlockId } from "./block-entry-utils.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MAP_COLORS_PATH = path.join(ROOT, "src", "data", "mapColors.ts");
const OUT_ROOT = path.join(ROOT, "assets", "block-icons-source");
const RAW_ROOT = path.join(OUT_ROOT, "raw");
const BLOCK_ROOT = path.join(OUT_ROOT, "blocks");
const REPORT_ROOT = path.join(ROOT, "reports", "block-icons-sync");
const MANIFEST_PATH = path.join(OUT_ROOT, "manifest.json");

const ASSET_HOST = "https://assets.mcasset.cloud";
const ASSET_VERSION = "latest";

const SIDE_KEYS = ["side", "all", "texture", "particle", "end", "front", "cross"];
const TOP_KEYS = ["top", "up", "end", "all", "particle", "side", "texture", "cross"];
const BOTTOM_KEYS = ["bottom", "down", "end", "all", "particle", "side", "texture", "cross"];
const FALLBACK_TEXTURE = "assets/minecraft/textures/block/stone.png";

const SIDE_ICON_PREFER_ITEM_PATTERNS = [
  /_carpet$/,
  /_slab$/,
  /_stairs$/,
  /_fence$/,
  /_fence_gate$/,
  /_wall$/,
  /_trapdoor$/,
  /_door$/,
  /_button$/,
  /_pressure_plate$/,
  /_sign$/,
  /_hanging_sign$/,
  /_banner$/,
  /_bed$/,
  /_candle$/,
  /_candle_cake$/,
  /_head$/,
  /_skull$/,
  /^potted_/,
];
const SIDE_ICON_NEVER_PREFER_ITEM_BLOCKS = new Set([
  "nether_sprouts",
  "nether_wart",
  "sugar_cane",
  "pointed_dripstone",
]);
const BLOCK_TEXTURE_CANDIDATE_OVERRIDES = {
  // Use a connected-line texture for icon generation (the UI renders this as a plus).
  redstone_wire: {
    top: ["assets/minecraft/textures/block/redstone_dust_line0.png"],
    side: ["assets/minecraft/textures/block/redstone_dust_line0.png"],
    bottom: ["assets/minecraft/textures/block/redstone_dust_line0.png"],
  },
  // Item texture reads better than the full-face side tile at small icon scale.
  hopper: {
    side: ["assets/minecraft/textures/item/hopper.png"],
  },
  repeater: {
    top: ["assets/minecraft/textures/item/repeater.png"],
    side: ["assets/minecraft/textures/item/repeater.png"],
    bottom: ["assets/minecraft/textures/item/repeater.png"],
  },
  comparator: {
    top: ["assets/minecraft/textures/item/comparator.png"],
    side: ["assets/minecraft/textures/item/comparator.png"],
    bottom: ["assets/minecraft/textures/item/comparator.png"],
  },
  cauldron: {
    side: ["assets/minecraft/textures/item/cauldron.png"],
  },
  nether_wart: {
    top: ["assets/minecraft/textures/block/nether_wart_stage2.png"],
    side: ["assets/minecraft/textures/block/nether_wart_stage2.png"],
    bottom: ["assets/minecraft/textures/block/nether_wart_stage2.png"],
  },
  pointed_dripstone: {
    top: ["assets/minecraft/textures/block/pointed_dripstone_up_base.png"],
    side: ["assets/minecraft/textures/block/pointed_dripstone_up_tip.png"],
    bottom: ["assets/minecraft/textures/block/pointed_dripstone_up_base.png"],
  },
  weeping_vines: {
    top: ["assets/minecraft/textures/block/weeping_vines_plant.png"],
    side: ["assets/minecraft/textures/block/weeping_vines_plant.png"],
    bottom: ["assets/minecraft/textures/block/weeping_vines_plant.png"],
  },
};

const jsonCache = new Map();
const modelCache = new Map();
const binPathCache = new Map();

function parseBlocksFromMapColors(tsText) {
  const entries = [];
  const rowRe = /\{\s*name:\s*"([^"]+)"[\s\S]*?blocks:\s*\[([\s\S]*?)\]\s*\}/g;
  for (const m of tsText.matchAll(rowRe)) {
    const content = m[2];
    for (const strMatch of content.matchAll(/"([^"]+)"/g)) {
      entries.push(strMatch[1]);
    }
  }
  return [...new Set(entries.map(blockIdOnly).filter(Boolean))].sort();
}

function assetUrl(assetPath) {
  return `${ASSET_HOST}/${ASSET_VERSION}/${assetPath}`;
}

async function fetchJson(assetPath) {
  if (jsonCache.has(assetPath)) return jsonCache.get(assetPath);
  const p = (async () => {
    const res = await fetch(assetUrl(assetPath));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed JSON ${assetPath}: HTTP ${res.status}`);
    return res.json();
  })();
  jsonCache.set(assetPath, p);
  return p;
}

function canonicalModelId(modelId) {
  if (!modelId) return null;
  if (modelId.includes(":")) {
    const [ns, p] = modelId.split(":");
    return `${ns}:${p}`;
  }
  return `minecraft:${modelId}`;
}

function modelPathFromId(modelId) {
  const id = canonicalModelId(modelId);
  if (!id) return null;
  const [ns, p] = id.split(":");
  return `assets/${ns}/models/${p}.json`;
}

async function loadResolvedModel(modelId) {
  const canon = canonicalModelId(modelId);
  if (!canon) return null;
  if (modelCache.has(canon)) return modelCache.get(canon);

  const p = (async () => {
    const modelPath = modelPathFromId(canon);
    const model = await fetchJson(modelPath);
    if (!model) return null;
    let parentResolved = null;
    if (typeof model.parent === "string") {
      parentResolved = await loadResolvedModel(model.parent);
    }
    return {
      textures: { ...(parentResolved?.textures || {}), ...(model.textures || {}) },
      elements: model.elements ?? parentResolved?.elements ?? [],
    };
  })();
  modelCache.set(canon, p);
  return p;
}

function resolveTextureRef(ref, textures, depth = 0) {
  if (!ref || depth > 20) return null;
  if (typeof ref !== "string") return null;
  if (!ref.startsWith("#")) return ref;
  const key = ref.slice(1);
  const next = textures?.[key];
  if (!next || next === ref) return null;
  return resolveTextureRef(next, textures, depth + 1);
}

function textureRefToAssetPath(ref) {
  if (!ref) return null;
  let namespace = "minecraft";
  let texPath = ref;
  if (ref.includes(":")) {
    [namespace, texPath] = ref.split(":");
  }
  if (texPath.startsWith("textures/")) {
    return `assets/${namespace}/${texPath}.png`;
  }
  if (!texPath.includes("/")) texPath = `block/${texPath}`;
  return `assets/${namespace}/textures/${texPath}.png`;
}

function firstResolvedKey(textures, keys) {
  for (const key of keys) {
    const resolved = resolveTextureRef(`#${key}`, textures);
    if (resolved) return resolved;
  }
  return null;
}

function firstResolvedFace(elements, faceKeys, textures) {
  for (const faceKey of faceKeys) {
    for (const element of elements || []) {
      const texture = element?.faces?.[faceKey]?.texture;
      const resolved = resolveTextureRef(texture, textures);
      if (resolved) return resolved;
    }
  }
  return null;
}

async function pickModelIdForBlock(blockId) {
  const state = await fetchJson(`assets/minecraft/blockstates/${blockId}.json`);
  if (!state) return `minecraft:block/${blockId}`;

  if (state.variants && typeof state.variants === "object") {
    const variantKey =
      Object.prototype.hasOwnProperty.call(state.variants, "") ? "" : Object.keys(state.variants).sort()[0];
    const variantValue = state.variants[variantKey];
    const picked = Array.isArray(variantValue) ? variantValue[0] : variantValue;
    if (picked?.model) return picked.model;
  }

  if (Array.isArray(state.multipart)) {
    for (const part of state.multipart) {
      const apply = Array.isArray(part?.apply) ? part.apply[0] : part?.apply;
      if (apply?.model) return apply.model;
    }
  }

  return `minecraft:block/${blockId}`;
}

async function resolveBlockTextureTriplet(blockId) {
  const assetBlockId = mapLegacyBlockId(blockId);
  const directBlock = `block/${assetBlockId}`;
  const directItem = `item/${assetBlockId}`;
  const modelId = await pickModelIdForBlock(assetBlockId);
  const model = await loadResolvedModel(modelId);

  let topRef = null;
  let bottomRef = null;
  let sideRef = null;

  if (model) {
    const textures = model.textures || {};
    const elements = model.elements || [];

    topRef = firstResolvedFace(elements, ["up"], textures) ?? firstResolvedKey(textures, TOP_KEYS);
    bottomRef = firstResolvedFace(elements, ["down"], textures) ?? firstResolvedKey(textures, BOTTOM_KEYS);
    sideRef =
      firstResolvedFace(elements, ["north", "south", "east", "west"], textures) ?? firstResolvedKey(textures, SIDE_KEYS);

    const anyTextureRef =
      topRef ||
      sideRef ||
      bottomRef ||
      Object.values(textures)
        .map(t => resolveTextureRef(t, textures))
        .find(Boolean) ||
      null;
    if (!topRef) topRef = anyTextureRef;
    if (!sideRef) sideRef = anyTextureRef;
    if (!bottomRef) bottomRef = anyTextureRef;
  }

  let top = textureRefToAssetPath(topRef);
  let side = textureRefToAssetPath(sideRef);
  let bottom = textureRefToAssetPath(bottomRef);

  if (!top) top = `assets/minecraft/textures/${directBlock}.png`;
  if (!side) side = `assets/minecraft/textures/${directBlock}.png`;
  if (!bottom) bottom = `assets/minecraft/textures/${directBlock}.png`;

  const resolved = {
    modelId: canonicalModelId(modelId),
    itemCandidates: [`assets/minecraft/textures/${directItem}.png`],
    topCandidates: [top, `assets/minecraft/textures/${directItem}.png`, FALLBACK_TEXTURE],
    sideCandidates: [side, `assets/minecraft/textures/${directItem}.png`, FALLBACK_TEXTURE],
    bottomCandidates: [bottom, `assets/minecraft/textures/${directItem}.png`, FALLBACK_TEXTURE],
  };
  const override = BLOCK_TEXTURE_CANDIDATE_OVERRIDES[assetBlockId];
  if (override) {
    const prependUnique = (base, extra = []) => [...extra, ...base.filter(v => !extra.includes(v))];
    resolved.topCandidates = prependUnique(resolved.topCandidates, override.top);
    resolved.sideCandidates = prependUnique(resolved.sideCandidates, override.side);
    resolved.bottomCandidates = prependUnique(resolved.bottomCandidates, override.bottom);
  }
  return resolved;
}

function shouldPreferItemSideIcon(blockId, topPick, sidePick, itemPick) {
  if (!sidePick || !itemPick) return false;
  if (SIDE_ICON_NEVER_PREFER_ITEM_BLOCKS.has(blockId)) return false;
  if (SIDE_ICON_PREFER_ITEM_PATTERNS.some(rx => rx.test(blockId))) return true;

  const sideAsset = sidePick.assetPath;
  const topAsset = topPick?.assetPath || null;
  const itemAsset = itemPick.assetPath;
  if (topAsset && sideAsset === topAsset && itemAsset !== sideAsset) return true;
  if (sideAsset === FALLBACK_TEXTURE && itemAsset !== FALLBACK_TEXTURE) return true;
  return false;
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureAssetPng(assetPath) {
  if (!assetPath.endsWith(".png")) return null;
  if (binPathCache.has(assetPath)) return binPathCache.get(assetPath);

  const p = (async () => {
    const localPath = path.join(RAW_ROOT, assetPath);
    if (await fileExists(localPath)) return localPath;

    const res = await fetch(assetUrl(assetPath));
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("image/png")) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, buf);
    return localPath;
  })();

  binPathCache.set(assetPath, p);
  return p;
}

async function pickExistingTexture(candidates) {
  for (const c of candidates) {
    const hit = await ensureAssetPng(c);
    if (hit) return { localPath: hit, assetPath: c };
  }
  return null;
}

async function copyTexture(src, dst) {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
}

async function getLatestVersionLabel() {
  const res = await fetch(assetUrl("assets/minecraft/textures/block/stone.png"), { method: "HEAD" });
  return res.headers.get("x-minecraft-version") || "unknown";
}

async function loadAllBlockstateIds() {
  const json = await fetchJson("assets/minecraft/blockstates/_list.json");
  if (!json?.files) return [];
  return json.files
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(/\.json$/, ""))
    .sort();
}

async function main() {
  const mapColorsTs = await fs.readFile(MAP_COLORS_PATH, "utf8");
  const blockIds = parseBlocksFromMapColors(mapColorsTs);
  const latestVersion = await getLatestVersionLabel();

  await fs.mkdir(OUT_ROOT, { recursive: true });
  await fs.mkdir(RAW_ROOT, { recursive: true });
  await fs.mkdir(BLOCK_ROOT, { recursive: true });
  await fs.mkdir(REPORT_ROOT, { recursive: true });

  const manifest = {
    source: {
      provider: "mcasset.cloud",
      endpoint: `${ASSET_HOST}/${ASSET_VERSION}`,
      minecraftVersion: latestVersion,
      generatedAt: new Date().toISOString(),
      blockCount: blockIds.length,
    },
    blocks: {},
  };

  const unresolved = [];
  let done = 0;
  for (const blockId of blockIds) {
    const resolved = await resolveBlockTextureTriplet(blockId);
    const topPick = await pickExistingTexture(resolved.topCandidates);
    const sidePickRaw = await pickExistingTexture(resolved.sideCandidates);
    const itemPick = await pickExistingTexture(resolved.itemCandidates);
    const sidePick = shouldPreferItemSideIcon(blockId, topPick, sidePickRaw, itemPick) ? itemPick : sidePickRaw;
    const bottomPick = await pickExistingTexture(resolved.bottomCandidates);

    const outDir = path.join(BLOCK_ROOT, blockId);
    await fs.mkdir(outDir, { recursive: true });

    const missingSlots = [];
    if (topPick) await copyTexture(topPick.localPath, path.join(outDir, "top.png"));
    else missingSlots.push("top");
    if (sidePick) await copyTexture(sidePick.localPath, path.join(outDir, "side.png"));
    else missingSlots.push("side");
    if (bottomPick) await copyTexture(bottomPick.localPath, path.join(outDir, "bottom.png"));
    else missingSlots.push("bottom");

    if (missingSlots.length > 0) unresolved.push({ blockId, missingSlots });

    manifest.blocks[blockId] = {
      modelId: resolved.modelId,
      files: {
        top: topPick ? `block-icons/blocks/${blockId}/top.png` : null,
        side: sidePick ? `block-icons/blocks/${blockId}/side.png` : null,
        bottom: bottomPick ? `block-icons/blocks/${blockId}/bottom.png` : null,
      },
      sourceTextures: {
        top: topPick?.assetPath || null,
        side: sidePick?.assetPath || null,
        bottom: bottomPick?.assetPath || null,
      },
    };

    ++done;
    if (done % 50 === 0 || done === blockIds.length) {
      console.log(`processed ${done}/${blockIds.length}`);
    }
  }

  const allBlockstates = await loadAllBlockstateIds();
  // Compare against canonical block ids so legacy mapColors names do not show as false-missing.
  const mapBlockSet = new Set(blockIds.map(mapLegacyBlockId));
  const missingFromMapColors = allBlockstates.filter(id => !mapBlockSet.has(id));

  const unresolvedPath = path.join(REPORT_ROOT, "unresolved-textures.txt");
  const missingPath = path.join(REPORT_ROOT, "missing-from-mapcolors.txt");
  const metaPath = path.join(REPORT_ROOT, "summary.txt");

  await fs.writeFile(
    unresolvedPath,
    unresolved.length
      ? unresolved.map(r => `${r.blockId}: ${r.missingSlots.join(", ")}`).join("\n") + "\n"
      : "",
    "utf8",
  );
  await fs.writeFile(missingPath, missingFromMapColors.join("\n") + "\n", "utf8");
  await fs.writeFile(
    metaPath,
    [
      `Minecraft version: ${latestVersion}`,
      `MapColors unique block ids: ${blockIds.length}`,
      `Blockstates total: ${allBlockstates.length}`,
      `Missing from mapColors: ${missingFromMapColors.length}`,
      `Unresolved texture triplets: ${unresolved.length}`,
    ].join("\n") + "\n",
    "utf8",
  );

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log("done");
  console.log(`manifest: ${path.relative(ROOT, MANIFEST_PATH)}`);
  console.log(`missing report: ${path.relative(ROOT, missingPath)}`);
  console.log(`unresolved report: ${path.relative(ROOT, unresolvedPath)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
