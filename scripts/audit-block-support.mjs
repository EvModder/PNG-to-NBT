#!/usr/bin/env bun
/**
 * Public API: auditBlockSupport() (maintenance/tests only)
 * Callers:
 * - website/tests/minecraftVersions.mts
 *
 * No game binaries, review tables or probe results belong in the browser bundle.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MINECRAFT_VERSIONS } from "../website/src/data/minecraftVersions.ts";
import { FRAGILE_SUPPORT_RULES, isFragileBlock } from "../website/src/data/fragileBlocks.ts";
import { canSupportBlock, getBlockSupport } from "../website/src/lib/blockSupport.ts";
import { getMinecraftCatalog } from "../website/src/lib/minecraftVersion.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const REPORT_DIR = path.join(ROOT, "work_files/reports/block-support");
const REVIEW = path.join(import.meta.dirname, "block-support-review.json");
const fingerprint = value => createHash("sha256").update(JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
const transpiler = new Bun.Transpiler({ loader: "ts", minifyWhitespace: true });
// Ignore comments/formatting, but require a cached registry recheck after rule changes.
const policyHash = fingerprint(await Promise.all(["data/fragileBlocks.ts", "lib/blockSupport.ts"].map(async file =>
  transpiler.transformSync(await fs.readFile(new URL(`../website/src/${file}`, import.meta.url), "utf8")))));

function command(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed: ${result.error?.message ?? (result.stdout + result.stderr).slice(-4000)}`);
  return result.stdout;
}

async function probe(server) {
  const gameDir = path.join(REPORT_DIR, "game");
  await fs.rm(gameDir, { recursive: true, force: true });
  await fs.mkdir(gameDir, { recursive: true });
  command("jar", ["--extract", "--file", path.resolve(server), "META-INF/libraries", "META-INF/versions"], gameDir);
  const jars = (await fs.readdir(path.join(gameDir, "META-INF"), { recursive: true }))
    .filter(file => file.endsWith(".jar")).sort().map(file => path.join(gameDir, "META-INF", file));
  const games = jars.filter(file => file.includes(`${path.sep}versions${path.sep}`));
  if (games.length !== 1) throw new Error("Expected one bundled vanilla server version");
  const output = path.join(REPORT_DIR, "probe.json");
  const supports = path.join(REPORT_DIR, "substrates.txt");
  await fs.writeFile(supports, [...new Set(["air", "stone", "glass", "glass_pane", "oak_leaves", "decorated_pot", "hopper", "scaffolding", "water",
    ...[...FRAGILE_SUPPORT_RULES.values()].flatMap(rule => rule.validSupportBlocks)])].sort().join("\n") + "\n");
  command("java", ["--class-path", jars.join(path.delimiter), path.join(import.meta.dirname, "BlockSupportProbe.java"), games[0], output, supports], gameDir);
  return JSON.parse(await fs.readFile(output, "utf8"));
}

function currentTarget() {
  const [version, target] = Object.entries(MINECRAFT_VERSIONS).at(-1);
  return { version, ...target, catalogHash: fingerprint(Object.entries(MINECRAFT_VERSIONS).map(([key, value]) =>
    [key, value, getMinecraftCatalog(value.dataVersion)])), policyHash };
}

function requiresBelow(facts, kinds) {
  return facts.gravity || kinds.get(facts.survival) === "ground"
    || kinds.get(facts.survival) === "independent" && kinds.get(facts.placement) === "ground";
}

// Callers:
// - website/tests/minecraftVersions.mts
export function auditBlockSupport(review, registry, previous) {
  const target = currentTarget();
  const errors = [];
  const changedBlocks = [];
  const changedTags = [];
  const shapeDifferences = [];
  const kinds = new Map();
  for (const group of review.implementations) {
    if (!["independent", "ground", "context"].includes(group.kind) || !group.note.trim()) errors.push("Every implementation group needs a classification and explanatory note");
    for (const name of group.classes) {
      if (kinds.has(name)) errors.push(`Duplicate implementation review: ${name}`);
      kinds.set(name, group.kind);
    }
  }
  for (const [id, note] of Object.entries(review.omitted)) if (!note.trim()) errors.push(`Missing omission reason: ${id}`);
  for (const exception of review.shapeExceptions) if (!exception.note.trim()) errors.push("Missing shape exception reason");
  if (fingerprint(review.target) !== fingerprint(target)) errors.push("Support review is stale: audit the current Minecraft target and catalog");
  for (const [block, rule] of FRAGILE_SUPPORT_RULES) {
    if (!isFragileBlock(block) || !rule.validSupportBlocks.length || !canSupportBlock(rule.replacementBlock, block, target.dataVersion)) {
      errors.push(`Inconsistent substrate rule/replacement: ${block}`);
    }
  }
  if (!registry) return { errors, changedBlocks, changedTags, shapeDifferences };
  if (registry.schema !== 1 || registry.dataVersion !== target.dataVersion) {
    errors.push("Probe schema/DataVersion does not match the current target");
    return { errors, changedBlocks, changedTags, shapeDifferences };
  }
  const catalog = getMinecraftCatalog(target.dataVersion);
  for (const entry of [...catalog.blocks.flat(), ...catalog.excluded.flat()]) {
    const id = entry.split("[")[0];
    if (!Object.hasOwn(registry.blocks, id)) errors.push(`Catalog block missing from vanilla probe: ${entry}`);
    if (review.omitted[id]) errors.push(`Catalog block needs a real rule, not an omission: ${id}`);
  }
  for (const [id, facts] of Object.entries(registry.blocks)) {
    for (const field of ["survival", "placement"]) {
      if (!kinds.has(facts[field])) errors.push(`Unreviewed ${field} implementation: ${facts[field]} (${id})`);
    }
    const ground = requiresBelow(facts, kinds);
    if (ground && !isFragileBlock(id) && !review.omitted[id]) errors.push(`Unclassified below-support requirement: ${id} (${facts.survival}/${facts.placement})`);
    if (facts.on.air === false && !isFragileBlock(id) && !review.omitted[id] && kinds.get(facts.survival) !== "context") {
      errors.push(`Vanilla rejects air below unclassified block: ${id}`);
    }
    if (ground && !facts.gravity && isFragileBlock(id)) for (const [base, expected] of Object.entries(facts.on)) {
      if (typeof expected !== "boolean") errors.push(`Unmodeled survival probe: ${id} on ${base}`);
      else if (canSupportBlock(base, facts.default, target.dataVersion) !== expected) errors.push(`Below-support rule differs from vanilla: ${id} on ${base}`);
    }
    for (const [entry, state] of Object.entries(facts.states)) {
      const support = getBlockSupport(entry, target.dataVersion);
      const different = Object.keys(state).filter(key => state[key] !== support[key]);
      if (different.length) {
        shapeDifferences.push({ entry, different, vanilla: state, model: Object.fromEntries(Object.keys(state).map(key => [key, support[key]])) });
        for (const key of different) if (!review.shapeExceptions.some(exception => exception.classes.includes(facts.class)
          && exception.properties.includes(key) && exception.model === support[key])) {
          errors.push(`Unreviewed ${key} shape difference: ${id} (${facts.class})`);
        }
      }
    }
    if (previous && fingerprint(previous.blocks[id]) !== fingerprint(facts)) changedBlocks.push(id);
  }
  for (const id of Object.keys(review.omitted)) if (!Object.hasOwn(registry.blocks, id)) errors.push(`Stale reviewed block: ${id}`);
  if (previous) for (const id of Object.keys(previous.blocks)) if (!Object.hasOwn(registry.blocks, id)) changedBlocks.push(id);
  if (previous) for (const field of ["blockTags", "fluidTags"]) {
    for (const tag of new Set([...Object.keys(previous[field] ?? {}), ...Object.keys(registry[field])])) {
      if (fingerprint(previous[field]?.[tag] ?? null) !== fingerprint(registry[field][tag] ?? null)) changedTags.push(`${field}/${tag}`);
    }
  }
  if (review.registryHash !== fingerprint(registry)) errors.push("Vanilla registry/support facts changed; review the probe and update its fingerprint");
  return { errors: [...new Set(errors)], changedBlocks, changedTags, shapeDifferences };
}

async function main() {
  const args = process.argv.slice(2);
  const values = {};
  const update = args.includes("--update-review");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--update-review") continue;
    if (!["--server", "--input", "--compare"].includes(args[i]) || !args[i + 1] || values[args[i]]) {
      throw new Error("Usage: audit-block-support.mjs [--server vanilla-server.jar | --input probe.json] [--compare previous-probe.json] [--update-review]");
    }
    values[args[i]] = args[++i];
  }
  if (values["--server"] && values["--input"]) throw new Error("Choose --server or --input, not both");
  let review = JSON.parse(await fs.readFile(REVIEW, "utf8"));
  const registry = values["--server"] ? await probe(values["--server"])
    : values["--input"] ? JSON.parse(await fs.readFile(values["--input"], "utf8")) : undefined;
  const previous = values["--compare"] ? JSON.parse(await fs.readFile(values["--compare"], "utf8")) : undefined;
  if (previous && !registry) throw new Error("--compare needs --server or --input");
  if (update) {
    if (!registry) throw new Error("--update-review needs a vanilla registry probe");
    for (const group of review.implementations) group.classes.sort();
    for (const exception of review.shapeExceptions) { exception.classes.sort(); exception.properties.sort(); }
    review = { target: currentTarget(), implementations: review.implementations, omitted: review.omitted,
      shapeExceptions: review.shapeExceptions, registryHash: fingerprint(registry) };
  }
  const report = auditBlockSupport(review, registry, previous);
  if (registry) {
    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(path.join(REPORT_DIR, "report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  if (report.errors.length) throw new Error(`${report.errors.slice(0,12).join("\n")}\n${report.errors.length} issues; full report: work_files/reports/block-support/report.json`);
  if (update) await fs.writeFile(REVIEW, JSON.stringify(review, null, 2) + "\n");
  console.log(`Block support audit passed (${registry ? `${Object.keys(registry.blocks).length} vanilla blocks` : "offline review coverage"})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
