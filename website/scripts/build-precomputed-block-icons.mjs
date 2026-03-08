#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MAP_COLORS_PATH = path.join(ROOT, "src", "data", "mapColors.ts");
const EXCLUDED_COLORS_PATH = path.join(ROOT, "src", "data", "excludedColors.ts");
const PUBLIC_ICON_ROOT = path.join(ROOT, "public", "block-icons");
const SOURCE_ICON_ROOT = path.join(ROOT, "assets", "block-icons-source");
const OUT_DIR = path.join(PUBLIC_ICON_ROOT, "precomputed");
const BLOCK_ICON_HTACCESS = `<IfModule mod_headers.c>
  <FilesMatch "\\.png$">
    Header set Cache-Control "public, max-age=604800, stale-while-revalidate=86400"
  </FilesMatch>
</IfModule>
`;
const UNUSED_DIR = path.join(OUT_DIR, "unused");

// Keep icons for explicitly excluded blocks under precomputed/unused so they can
// be surfaced by future UI toggles without reworking the icon pipeline.
const EXCLUDED_BLOCK_PATTERNS = [
  /_stairs$/,
  /_shulker_box$/,
  /_button$/,
  /_wall$/,
  /_fence$/,
  /_fence_gate$/,
  /_trapdoor$/,
  /_door$/,
  /_sign$/,
  /_stained_glass_pane$/,
  /lightning_rod$/,
];

const EXCLUDED_BLOCK_IDS = new Set([
  // Obtainable but intentionally excluded.
  "dragon_egg",
  "nether_portal",
  "hopper",
  "cauldron",
  "farmland",
  "dirt_path",
  "grindstone",
  "brewing_stand",
  "heavy_core",
  "player_head",
  "player_wall_head",
  "zombie_head",
  "zombie_wall_head",
  "skeleton_skull",
  "skeleton_wall_skull",
  "wither_skeleton_skull",
  "wither_skeleton_wall_skull",
  "creeper_head",
  "creeper_wall_head",
  "dragon_head",
  "dragon_wall_head",
  "piglin_head",
  "piglin_wall_head",
  // Unobtainable/admin-only omissions.
  "barrier",
  "structure_void",
  "light",
  "jigsaw",
  "structure_block",
  "command_block",
  "chain_command_block",
  "repeating_command_block",
  "end_portal",
  "reinforced_deepslate",
  "spawner",
  "budding_amethyst",
  "trial_spawner",
  "vault",
  "infested_stone",
  "infested_cobblestone",
  "infested_stone_bricks",
  "infested_mossy_stone_bricks",
  "infested_cracked_stone_bricks",
  "infested_chiseled_stone_bricks",
  "infested_deepslate",
]);

function normalizeBlockEntry(entry) {
  return entry.trim().replace(/^minecraft:/, "");
}

function blockIdOnly(entry) {
  return normalizeBlockEntry(entry).split("[")[0];
}

function isExplicitlyExcludedBlockId(blockId) {
  if (EXCLUDED_BLOCK_IDS.has(blockId)) return true;
  return EXCLUDED_BLOCK_PATTERNS.some(rx => rx.test(blockId));
}

function toBlockIconKey(raw) {
  return normalizeBlockEntry(raw)
    .replace(/__/g, "__us__")
    .replace(/\[/g, "__lb__")
    .replace(/\]/g, "__rb__")
    .replace(/=/g, "__eq__")
    .replace(/,/g, "__cm__")
    .replace(/:/g, "__cl__");
}

function parseMapColors(tsText) {
  const rows = [];
  const rowRe = /\{\s*name:\s*"([^"]+)"[\s\S]*?blocks:\s*\[([\s\S]*?)\]\s*\}/g;
  for (const m of tsText.matchAll(rowRe)) {
    const name = m[1];
    const content = m[2];
    const entries = [...content.matchAll(/"([^"]+)"/g)].map(s => normalizeBlockEntry(s[1]));
    rows.push({ name, entries });
  }
  return rows;
}

function parseExcludedColors(tsText) {
  const out = [];
  const rowRe = /(\d+):\s*\[([\s\S]*?)\],/g;
  for (const m of tsText.matchAll(rowRe)) {
    const entries = [...m[2].matchAll(/"([^"]+)"/g)].map(s => normalizeBlockEntry(s[1]));
    out.push(...entries);
  }
  return [...new Set(out)];
}

const CUSTOM_SOURCES = {
  fire: "custom/fire_side.png",
  redstone_wire: "custom/redstone_wire_top.png",
  tripwire: "custom/tripwire_top.png",
  beacon: "custom/beacon_side.png",
  conduit: "custom/conduit_icon.png",
  cherry_log: "custom/cherry_log.png",
  cartography_table: "custom/cartography_table_side2.png",
  chest: "custom/chest_side.png",
  trapped_chest: "custom/trapped_chest_side.png",
  ender_chest: "custom/ender_chest_front.png",
  lectern: "custom/lectern_blocksprite.png",
  grindstone: "custom/grindstone_side_ref.png",
  heavy_core: "custom/heavy_core_ref.png",
  dispenser: "custom/dispenser_front.png",
  dropper: "custom/dropper_front.png",
  daylight_detector: "custom/daylight_detector_side.png",
  anvil: "custom/anvil_side.png",
  end_rod: "custom/end_rod_side.png",
  lightning_rod: "custom/lightning_rod_side.png",
  repeater: "custom/repeater_top.png",
  comparator: "custom/comparator_top.png",
};

const TOP_FACE_BLOCKS = new Set([
  "jukebox",
  "pink_petals",
  "wildflowers",
  "leaf_litter",
  "chorus_flower",
  "bone_block",
]);
const TOP_FACE_ONLY_BLOCKS = new Set(["glass_pane"]);
const ITEM_ICON_SOURCES = {
  hopper: "item/hopper.png",
  cauldron: "item/cauldron.png",
  lever: "item/lever.png",
  leaf_litter: "item/leaf_litter.png",
  powder_snow: "item/powder_snow_bucket.png",
};

function isLogOrStem(id) {
  return id.endsWith("_log") || id.endsWith("_stem") || id.endsWith("_stripped_log");
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveSource(blockEntry) {
  const normalized = normalizeBlockEntry(blockEntry);
  const exactCustom = path.join(SOURCE_ICON_ROOT, "custom", `${normalized}.png`);
  if (await fileExists(exactCustom)) return exactCustom;

  const primaryBlockId = blockIdOnly(normalized);
  const candidateBlockIds = (() => {
    const out = [primaryBlockId];
    if (primaryBlockId.endsWith("_wall_hanging_sign")) {
      out.push(
        primaryBlockId.replace(/_wall_hanging_sign$/, "_hanging_sign"),
        primaryBlockId.replace(/_wall_hanging_sign$/, "_sign"),
        "oak_sign",
      );
    } else if (primaryBlockId.endsWith("_hanging_sign")) {
      out.push(primaryBlockId.replace(/_hanging_sign$/, "_sign"), "oak_sign");
    } else if (primaryBlockId.endsWith("_wall_sign")) {
      out.push(primaryBlockId.replace(/_wall_sign$/, "_sign"), "oak_sign");
    } else if (primaryBlockId.endsWith("_sign")) {
      out.push("oak_sign");
    }
    if (primaryBlockId.endsWith("_lightning_rod")) out.push("lightning_rod");
    if (primaryBlockId === "chain_command_block" || primaryBlockId === "repeating_command_block") {
      out.push("command_block");
    }
    if (primaryBlockId === "trial_spawner" || primaryBlockId === "vault") out.push("spawner");
    if (primaryBlockId === "jigsaw") out.push("structure_block", "command_block");
    if (primaryBlockId === "end_portal") out.push("obsidian");
    if (primaryBlockId.startsWith("infested_")) out.push(primaryBlockId.replace(/^infested_/, ""));
    return [...new Set(out)];
  })();

  const tryResolveForBlockId = async (blockId) => {
    const item = ITEM_ICON_SOURCES[blockId];
    if (item) {
      const itemPath = path.join(SOURCE_ICON_ROOT, item);
      if (await fileExists(itemPath)) return itemPath;
    }

    const custom = CUSTOM_SOURCES[blockId];
    if (custom) {
      const customPath = path.join(SOURCE_ICON_ROOT, custom);
      if (await fileExists(customPath)) return customPath;
    }

    const preferTopFace =
      TOP_FACE_BLOCKS.has(blockId) ||
      TOP_FACE_ONLY_BLOCKS.has(blockId) ||
      blockId.endsWith("_trapdoor") ||
      isLogOrStem(blockId);
    const face = preferTopFace ? "top" : "side";
    const preferred = path.join(SOURCE_ICON_ROOT, "blocks", blockId, `${face}.png`);
    if (await fileExists(preferred)) return preferred;

    const fallbackSide = path.join(SOURCE_ICON_ROOT, "blocks", blockId, "side.png");
    if (await fileExists(fallbackSide)) return fallbackSide;

    const fallbackTop = path.join(SOURCE_ICON_ROOT, "blocks", blockId, "top.png");
    if (await fileExists(fallbackTop)) return fallbackTop;

    const fallbackBottom = path.join(SOURCE_ICON_ROOT, "blocks", blockId, "bottom.png");
    if (await fileExists(fallbackBottom)) return fallbackBottom;
    return null;
  };

  for (const candidateId of candidateBlockIds) {
    const resolved = await tryResolveForBlockId(candidateId);
    if (resolved) return resolved;
  }
  return null;
}

async function main() {
  const mapColorsTs = await fs.readFile(MAP_COLORS_PATH, "utf8");
  const excludedColorsTs = await fs.readFile(EXCLUDED_COLORS_PATH, "utf8");
  const rows = parseMapColors(mapColorsTs);
  const excludedEntries = parseExcludedColors(excludedColorsTs);
  const blocks = [...new Set(rows.flatMap(r => r.entries))];
  const mappedBlockIds = new Set(blocks.map(blockIdOnly));
  const sourceBlockIds = (
    await fs.readdir(path.join(SOURCE_ICON_ROOT, "blocks"), { withFileTypes: true })
  ).filter(d => d.isDirectory()).map(d => d.name);

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(UNUSED_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, ".htaccess"), BLOCK_ICON_HTACCESS, "utf8");

  const missing = [];
  let copied = 0;
  let unusedCopied = 0;

  for (const block of blocks) {
    const src = await resolveSource(block);
    const dst = path.join(OUT_DIR, `${toBlockIconKey(block)}.png`);
    if (!src) {
      missing.push(block);
      continue;
    }
    await fs.copyFile(src, dst);
    ++copied;
  }

  const excludedUnusedIds = sourceBlockIds
    .filter(id => !mappedBlockIds.has(id) && isExplicitlyExcludedBlockId(id))
    .sort();
  for (const blockId of excludedUnusedIds) {
    const src = await resolveSource(blockId);
    if (!src) continue;
    const dst = path.join(UNUSED_DIR, `${toBlockIconKey(blockId)}.png`);
    await fs.copyFile(src, dst);
    ++unusedCopied;
  }
  // Also emit explicitly listed excluded entries (stateful/non-registry aliases)
  // so UI toggles can always show a texture for excluded options.
  for (const entry of excludedEntries) {
    const dst = path.join(UNUSED_DIR, `${toBlockIconKey(entry)}.png`);
    if (await fileExists(dst)) continue;
    const src = await resolveSource(entry);
    if (!src) continue;
    await fs.copyFile(src, dst);
    ++unusedCopied;
  }

  const worldBorderSrc = path.join(SOURCE_ICON_ROOT, "custom", "world_border.png");
  const worldBorderDst = path.join(OUT_DIR, "world_border.png");
  if (await fileExists(worldBorderSrc)) {
    await fs.copyFile(worldBorderSrc, worldBorderDst);
  }

  const reportPath = path.join(ROOT, "reports", "block-icons", "precomputed-missing.txt");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${missing.join("\n")}\n`, "utf8");

  console.log(`Precomputed icon entries: ${blocks.length}`);
  console.log(`Copied: ${copied}`);
  console.log(`Unused (excluded) copied: ${unusedCopied}`);
  console.log(`Missing: ${missing.length}`);
  console.log(`Out dir: ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`Missing report: ${path.relative(ROOT, reportPath)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
