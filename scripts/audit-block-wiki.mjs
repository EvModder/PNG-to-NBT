#!/usr/bin/env bun
// Run from website/: bun run audit:block-wiki. --offline checks catalog coverage only.
// Live checks need Chromium: bunx playwright install chromium (in website/).
// Network checks are maintenance-only; review corrections in data/blockWiki.ts, never auto-retarget links.
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { BLOCK_WIKI_PATHS, getBlockWikiUrl } from "../website/src/data/blockWiki.ts";
import { MINECRAFT_VERSIONS } from "../website/src/data/minecraftVersions.ts";
import { normalizeBlockId } from "../website/src/lib/blockId.ts";
import { getMinecraftCatalog } from "../website/src/lib/minecraftVersion.ts";

const REPORT_DIR = path.resolve(import.meta.dirname, "../work_files/reports/block-wiki");
const WIKI = "https://minecraft.wiki/w/";

async function queryWiki(parameters) {
  const response = await fetch(`https://minecraft.wiki/api.php?${new URLSearchParams({
    format: "json", formatversion: "2", ...parameters,
  })}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Wiki API: HTTP ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`Wiki API: ${data.error.code}`);
  return data;
}

async function checkFragments(page, title, fragments) {
  const url = WIKI + encodeURIComponent(title.replaceAll(" ", "_"));
  await page.goto(url);
  // Do not mistake an uninitialized or failed wiki tab script for a working target.
  await page.waitForFunction(() => document.querySelector("#mw-content-text .mw-parser-output")
    && !document.querySelector(".tabber:not(.tabberlive)"));
  const defaults = await page.locator(".tabberactive [data-hash]").evaluateAll(nodes => nodes.map(node => node.dataset.hash));
  const results = [];
  for (const fragment of fragments) {
    await page.goto(`${url}#${encodeURIComponent(fragment)}`);
    // Allow hashchange handlers and the resulting layout to finish.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(fragment => {
      const tabs = [...document.querySelectorAll(".tabbertab[data-hash]")].filter(tab => tab.dataset.hash === fragment);
      if (tabs.length) {
        const active = tabs.every(tab => tab.checkVisibility({ visibilityProperty: true })
          && [...tab.parentElement.querySelectorAll(".tabberactive [data-hash]")].some(link => link.dataset.hash === fragment));
        return { kind: "tab", error: active ? null : "Variant tab did not activate" };
      }
      const target = document.getElementById(fragment) ?? [...document.getElementsByName(fragment)].find(node => node.tagName === "A");
      if (!target) return { error: "Missing fragment" };
      const rect = target.getBoundingClientRect();
      const visible = target.getClientRects().length > 0 && getComputedStyle(target).visibility !== "hidden";
      return { kind: "section", error: visible && rect.bottom >= 0 && rect.top < innerHeight ? null : "Fragment target is not visible" };
    }, fragment);
    // Default tabs are intentional variant pins, not broken links; retain them if the wiki reorders tabs.
    results.push({ title, fragment, ...result, ...(result.kind === "tab" ? { default: defaults.includes(fragment) } : {}) });
  }
  return results;
}

async function main() {
  const offline = process.argv.includes("--offline");
  if (process.argv.slice(2).some(arg => arg !== "--offline")) throw new Error("Usage: audit-block-wiki.mjs [--offline]");
  const issues = [];
  const fragmentChecks = [];
  const ids = new Set();
  const versions = Object.keys(MINECRAFT_VERSIONS);
  for (const version of versions) {
    const catalog = getMinecraftCatalog(version);
    for (const block of [...catalog.blocks.flat(), ...catalog.excluded.flat()]) {
      const id = normalizeBlockId(block);
      ids.add(id);
      if (!Object.hasOwn(BLOCK_WIKI_PATHS, id)) {
        issues.push(`${version}: missing mapping for ${id}`);
      } else if (getBlockWikiUrl(block) !== WIKI + BLOCK_WIKI_PATHS[id]
        || getBlockWikiUrl(`minecraft:${id}[waterlogged=false]`) !== WIKI + BLOCK_WIKI_PATHS[id]) {
        issues.push(`${version}: namespace/state lookup mismatch for ${block}`);
      }
    }
  }

  const pages = new Map();
  for (const [id, target] of Object.entries(BLOCK_WIKI_PATHS)) {
    if (!ids.has(id)) issues.push(`Unused mapping: ${id}`);
    const url = new URL(WIKI + target);
    if (!target || url.origin !== "https://minecraft.wiki" || !url.pathname.startsWith("/w/")
      || url.search || target.includes(":") || target.includes(" ") || target.endsWith("#")) {
      issues.push(`Invalid article path: ${id} -> ${target}`);
      continue;
    }
    const title = decodeURIComponent(url.pathname.slice(3)).replaceAll("_", " ");
    const fragment = decodeURIComponent(url.hash.slice(1));
    if (!pages.has(title)) pages.set(title, new Set());
    if (fragment) pages.get(title).add(fragment);
  }

  if (!offline) {
    const titles = [...pages.keys()];
    const invalidPages = new Set();
    for (let start = 0; start < titles.length; start += 50) {
      const batch = titles.slice(start, start + 50);
      const { query } = await queryWiki({ action: "query", titles: batch.join("|"), prop: "pageprops", redirects: "1" });
      for (const redirect of query.redirects ?? []) {
        issues.push(`Redirect: ${redirect.from} -> ${redirect.to}${redirect.tofragment ? `#${redirect.tofragment}` : ""}`);
        invalidPages.add(redirect.from);
      }
      for (const normalized of query.normalized ?? []) {
        issues.push(`Noncanonical title: ${normalized.from} -> ${normalized.to}`);
        invalidPages.add(normalized.from);
      }
      for (const page of query.pages) {
        if (page.missing || page.invalid || Object.hasOwn(page.pageprops ?? {}, "disambiguation")) {
          issues.push(`Missing/invalid/disambiguation page: ${page.title}`);
          invalidPages.add(page.title);
        }
      }
      console.log(`Checked titles: ${Math.min(start + 50, titles.length)}/${titles.length}`);
    }
    // Resolve this maintenance dependency from website/, not from scripts/.
    const { chromium } = createRequire(new URL("../website/package.json", import.meta.url))("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const linkedPages = [...pages].filter(([title, fragments]) => fragments.size && !invalidPages.has(title));
      for (const [index, [title, fragments]] of linkedPages.entries()) {
        const results = await checkFragments(page, title, fragments);
        fragmentChecks.push(...results);
        for (const result of results) {
          if (result.error) issues.push(`${result.error}: ${title}#${result.fragment}`);
        }
        console.log(`Checked browser fragments: ${index + 1}/${linkedPages.length} (${title})`);
      }
    } finally {
      await browser.close();
    }
  }

  const summary = `${ids.size} block IDs, ${versions.length} versions, ${pages.size} articles, ${issues.length} issues (${offline ? "offline" : "live"}).`;
  if (!offline) {
    await fs.mkdir(REPORT_DIR, { recursive: true });
    await fs.writeFile(path.join(REPORT_DIR, "audit.json"), JSON.stringify({
      checkedAt: new Date().toISOString(), summary, versions, issues, fragmentChecks,
    }, null, 2) + "\n");
  }
  console.log(summary);
  for (const issue of issues) console.error(issue);
  if (issues.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(`Wiki audit incomplete: ${error.message}`);
  process.exitCode = 1;
});
