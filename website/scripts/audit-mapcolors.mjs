#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MAP_COLORS_PATH = path.join(ROOT, "src", "data", "mapColors.ts");
const REPORT_DIR = path.join(ROOT, "reports", "mapcolors");

const ASSET_HOST = "https://assets.mcasset.cloud";
const ASSET_VERSION = "latest";

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

const BLOCK_ID_ALIASES = {
  chain: "iron_chain",
  jigsaw_block: "jigsaw",
  vines: "vine",
  lapis_lazuli_ore: "lapis_ore",
};

function normalizeBlockEntry(entry) {
  return entry.trim().replace(/^minecraft:/, "");
}

function blockIdOnly(entry) {
  return normalizeBlockEntry(entry).split("[")[0];
}

function mapLegacyBlockId(blockId) {
  if (BLOCK_ID_ALIASES[blockId]) return BLOCK_ID_ALIASES[blockId];
  if (blockId.endsWith("_stripped_log")) {
    const prefix = blockId.slice(0, -"_stripped_log".length);
    return `stripped_${prefix}_log`;
  }
  if (blockId.endsWith("_stripped_wood")) {
    const prefix = blockId.slice(0, -"_stripped_wood".length);
    return `stripped_${prefix}_wood`;
  }
  return blockId;
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

function parseArgs(argv) {
  return {
    strictMissing: argv.includes("--strict-missing"),
  };
}

function isPatternExcluded(blockId) {
  return EXCLUDED_BLOCK_PATTERNS.some(rx => rx.test(blockId));
}

async function fetchJson(assetPath) {
  const res = await fetch(`${ASSET_HOST}/${ASSET_VERSION}/${assetPath}`);
  if (!res.ok) throw new Error(`Failed to fetch ${assetPath}: HTTP ${res.status}`);
  return res.json();
}

async function getLatestVersionLabel() {
  const res = await fetch(`${ASSET_HOST}/${ASSET_VERSION}/assets/minecraft/textures/block/stone.png`, { method: "HEAD" });
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

function findDuplicatesByRow(rows) {
  const duplicates = [];
  for (const row of rows) {
    const seen = new Map();
    for (const entry of row.entries) {
      const c = seen.get(entry) || 0;
      seen.set(entry, c + 1);
    }
    for (const [entry, count] of seen.entries()) {
      if (count > 1) duplicates.push({ row: row.name, entry, count });
    }
  }
  return duplicates;
}

function findDuplicatesAcrossRows(rows) {
  const owners = new Map();
  for (const row of rows) {
    for (const entry of row.entries) {
      const arr = owners.get(entry) || [];
      arr.push(row.name);
      owners.set(entry, arr);
    }
  }
  const cross = [];
  for (const [entry, rowNames] of owners.entries()) {
    const uniq = [...new Set(rowNames)];
    if (uniq.length > 1) cross.push({ entry, rows: uniq });
  }
  return cross.sort((a, b) => a.entry.localeCompare(b.entry));
}

async function writeReport(fileName, lines) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const out = path.join(REPORT_DIR, fileName);
  await fs.writeFile(out, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapColorsTs = await fs.readFile(MAP_COLORS_PATH, "utf8");
  const rows = parseMapColors(mapColorsTs);

  const dupWithin = findDuplicatesByRow(rows);
  const dupAcross = findDuplicatesAcrossRows(rows);

  const mapBlockIds = new Set();
  for (const row of rows) {
    for (const entry of row.entries) {
      mapBlockIds.add(mapLegacyBlockId(blockIdOnly(entry)));
    }
  }

  const allBlockstateIds = await loadAllBlockstateIds();
  const latestVersion = await getLatestVersionLabel();
  const missingAll = allBlockstateIds.filter(id => !mapBlockIds.has(id));
  const missingPatternExcluded = missingAll.filter(isPatternExcluded);
  const missingExplicitExcluded = missingAll.filter(id => EXCLUDED_BLOCK_IDS.has(id));
  const missingActionable = missingAll.filter(id => !isPatternExcluded(id) && !EXCLUDED_BLOCK_IDS.has(id));

  const excludedPresentInMapColors = [...EXCLUDED_BLOCK_IDS].filter(id => mapBlockIds.has(id));

  await writeReport("missing-all.txt", missingAll);
  await writeReport("missing-actionable.txt", missingActionable);
  await writeReport("missing-excluded-pattern.txt", missingPatternExcluded);
  await writeReport("missing-excluded-explicit.txt", missingExplicitExcluded);
  await writeReport(
    "duplicates-within-row.txt",
    dupWithin.length
      ? dupWithin.map(d => `${d.row}: ${d.entry} (x${d.count})`)
      : ["(none)"],
  );
  await writeReport(
    "duplicates-across-rows.txt",
    dupAcross.length
      ? dupAcross.map(d => `${d.entry}: ${d.rows.join(", ")}`)
      : ["(none)"],
  );
  await writeReport(
    "summary.txt",
    [
      `Minecraft version: ${latestVersion}`,
      `Color rows parsed: ${rows.length}`,
      `Unique mapped block IDs: ${mapBlockIds.size}`,
      `Registry block IDs: ${allBlockstateIds.length}`,
      `Missing (all): ${missingAll.length}`,
      `Missing (excluded by pattern): ${missingPatternExcluded.length}`,
      `Missing (excluded explicit): ${missingExplicitExcluded.length}`,
      `Missing (actionable): ${missingActionable.length}`,
      `Duplicates within same row: ${dupWithin.length}`,
      `Duplicates across rows: ${dupAcross.length}`,
      `Explicit exclusions present in mapColors: ${excludedPresentInMapColors.length}`,
      "",
      "Excluded patterns:",
      ...EXCLUDED_BLOCK_PATTERNS.map(rx => `- ${rx.toString()}`),
      "",
      "Explicitly excluded block IDs:",
      ...[...EXCLUDED_BLOCK_IDS].sort().map(id => `- ${id}`),
    ],
  );

  console.log(`Minecraft version: ${latestVersion}`);
  console.log(`Unique mapped block IDs: ${mapBlockIds.size}`);
  console.log(`Registry block IDs: ${allBlockstateIds.length}`);
  console.log(`Missing (all): ${missingAll.length}`);
  console.log(`Missing (actionable): ${missingActionable.length}`);
  console.log(`Duplicates within row: ${dupWithin.length}`);
  console.log(`Duplicates across rows: ${dupAcross.length}`);
  console.log(`Reports written to: ${path.relative(ROOT, REPORT_DIR)}`);

  if (dupWithin.length > 0 || dupAcross.length > 0) process.exit(1);
  if (args.strictMissing && missingActionable.length > 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
