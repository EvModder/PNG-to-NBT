// Checks that file and export headers match the code: purpose first, then Public API and
// Callers lists with one entry per line. `--fix` rewrites them from the code's exports and imports.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const FIX = process.argv.includes("--fix");

function listFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listFiles(path, extensions);
    return extensions.some(extension => name.endsWith(extension)) ? [relative(ROOT, path)] : [];
  });
}

const sources = listFiles(join(ROOT, "src"), SOURCE_EXTENSIONS).sort();
// Pages and build configs also load modules; tests and scripts are not callers.
const referrers = [
  ...sources, ...listFiles(join(ROOT, "src"), [".html"]), "index.html",
  ...readdirSync(ROOT).filter(name => /^vite.*\.config\.ts$/.test(name)),
];
const text = new Map(referrers.map(file => [file, readFileSync(join(ROOT, file), "utf8")]));

function resolveSpecifier(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join("src", specifier.slice(2));
  else if (specifier.startsWith("/src/")) base = specifier.slice(1);
  else if (specifier.startsWith(".")) base = join(dirname(from), specifier);
  else return null;
  base = normalize(base);
  return [base, ...SOURCE_EXTENSIONS.map(extension => base + extension), join(base, "index.ts")].find(path => text.has(path)) ?? null;
}

// Files that load each file, and files that take each export ("default" for default imports).
const fileCallers = new Map<string, Set<string>>();
const exportCallers = new Map<string, Set<string>>();
const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key)!.add(value);
};
for (const [file, source] of text) {
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const target = resolveSpecifier(file, match[2]);
    if (!target || target === file) continue;
    addTo(fileCallers, target, file);
    const clause = match[1];
    const names = [...clause.matchAll(/\{([^}]*)\}/g)].flatMap(group => group[1].split(","))
      .map(name => name.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const namespace = clause.match(/\*\s+as\s+(\w+)/)?.[1];
    if (namespace) names.push(...[...source.matchAll(new RegExp(`\\b${namespace}\\.(\\w+)`, "g"))].map(use => use[1]));
    if (/^\s*\w+\s*(?:,|$)/.test(clause)) names.push("default");
    for (const name of names) addTo(exportCallers, `${target}#${name}`, file);
  }
  for (const match of source.matchAll(/(?:\bimport\s*\(|new URL\(|\bsrc=)\s*["']([^"']+)["']/g)) {
    const target = resolveSpecifier(file, match[1]);
    if (!target || target === file) continue;
    addTo(fileCallers, target, file);
    addTo(exportCallers, `${target}#default`, file);
  }
}

const problems: string[] = [];
const report = (file: string, message: string) => problems.push(`${file}: ${message}`);
// Code-unit order, as used everywhere else in the project.
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const covers = (entry: string, path: string) => entry.endsWith("/*") ? dirname(path) === entry.slice(0, -2) : entry === path;

// Keep wildcards that still match a caller; list every other caller once, sorted.
function expectedCallers(listed: string[], actual: Set<string>): string[] {
  const wildcards = listed.filter(entry => entry.endsWith("/*") && [...actual].some(path => covers(entry, path)));
  const plain = [...actual].filter(path => !wildcards.some(entry => covers(entry, path)));
  return [...wildcards, ...plain].sort(byPath);
}

const DECLARATION = /^export\s+(?:declare\s+)?(?:async\s+)?(function|const|let|type|interface|enum|class)\s+(\w+)/;
function exportsOf(line: string): string[] {
  const declared = line.match(DECLARATION)?.[2];
  if (declared) return [declared];
  if (/^export default\b/.test(line)) return ["default"];
  const list = line.match(/^export\s+(?:type\s+)?\{([^}]*)\}/)?.[1];
  return list ? list.split(",").map(name => name.trim().split(/\s+as\s+/).pop()!).filter(Boolean) : [];
}

// Split ` * Label: a, b` plus following ` * - c` lines into entries.
function readEntries(lines: string[], start: number, prefix: string): { entries: string[]; end: number; inline: boolean } {
  const rest = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  const entries = rest ? rest.split(/,\s*/) : [];
  let end = start + 1;
  for (; end < lines.length && lines[end].startsWith(`${prefix} - `); ++end) entries.push(lines[end].slice(prefix.length + 3).trim());
  return { entries, end, inline: !!rest };
}

function checkFile(file: string): string | null {
  const source = text.get(file)!;
  const sourceLines = source.split("\n");
  const exported = new Map<string, boolean>();
  for (const line of sourceLines) {
    const declared = line.match(DECLARATION);
    // Arrow-function constants are listed as functions too.
    if (declared) exported.set(declared[2], declared[1] === "function" || /^export const \w+ = (?:async )?\([^()]*\)[^=]*=>/.test(line));
    else if (!/^export default\b/.test(line)) for (const name of exportsOf(line)) exported.set(name, false);
  }
  const defaultName = source.match(/^export default (?:memo\()?(?:function\s+)?(\w+)/m)?.[1];
  let changed = false;

  // Export-level lists cover the exports below them, up to the next blank line.
  for (let index = 0; index < sourceLines.length; ++index) {
    if (!sourceLines[index].startsWith("// Callers:")) continue;
    const { entries, end, inline } = readEntries(sourceLines, index, "//");
    let next = end;
    while (next < sourceLines.length && sourceLines[next].startsWith("//")) ++next;
    const names: string[] = [];
    for (let row = next; row < sourceLines.length && sourceLines[row].trim() && !sourceLines[row].startsWith("//"); ++row) names.push(...exportsOf(sourceLines[row]));
    if (!names.length) {
      report(file, `line ${index + 1}: Callers comment is not above an export`);
      continue;
    }
    const actual = new Set(names.flatMap(name => [...exportCallers.get(`${file}#${name}`) ?? []]));
    if (!actual.size) report(file, `${names.join(", ")}: no other file uses this export`);
    const expected = expectedCallers(entries, actual);
    if (inline || expected.join() !== entries.join()) {
      if (!actual.size) continue;
      report(file, `${names.join(", ")}: Callers should be ${expected.join(", ")}`);
      sourceLines.splice(index, end - index, "// Callers:", ...expected.map(entry => `// - ${entry}`));
      changed = true;
    }
  }

  const header = sourceLines.join("\n").match(/^((?:\/\/\/[^\n]*\n)*)\/\*\*\n([\s\S]*?)\n \*\//);
  const callers = fileCallers.get(file) ?? new Set<string>();
  if (!header) {
    if (exported.size || defaultName) report(file, "missing file header");
    return changed ? sourceLines.join("\n") : null;
  }
  const lines = header[2].split("\n");
  const purpose: string[] = [];
  let api: string[] | null = null;
  let listedCallers: string[] | null = null;
  let afterLists = false;
  let misplaced = false;
  for (let index = 0; index < lines.length;) {
    if (lines[index].startsWith(" * Public API:") || lines[index].startsWith(" * Callers:")) {
      const { entries, end } = readEntries(lines, index, " *");
      if (lines[index].startsWith(" * Public API:")) api = entries;
      else listedCallers = entries;
      afterLists = true;
      index = end;
      continue;
    }
    if (afterLists && lines[index].trim() !== "*") misplaced = true;
    purpose.push(lines[index]);
    ++index;
  }
  if (misplaced) report(file, "purpose text should come before Public API");

  const expectedApi: string[] = [];
  const apiNames = new Set<string>();
  for (const entry of api ?? []) {
    const name = entry.replace(/\(\)$/, "").replace(/ \(default\)$/, "");
    if (entry === "none" || entry.endsWith(" (default)")) continue;
    if (name.endsWith("*")) {
      const covered = [...exported.keys()].filter(key => key.startsWith(name.slice(0, -1)));
      if (covered.length) expectedApi.push(entry);
      covered.forEach(key => apiNames.add(key));
    } else if (exported.has(name)) {
      expectedApi.push(exported.get(name) ? `${name}()` : name);
      apiNames.add(name);
    }
  }
  for (const [name, isFunction] of exported) if (!apiNames.has(name)) expectedApi.push(isFunction ? `${name}()` : name);
  if (defaultName) expectedApi.push(`${defaultName} (default)`);
  if (!expectedApi.length) expectedApi.push("none");
  const expectedFileCallers = expectedCallers(listedCallers ?? [], callers);

  const trimmed = purpose.filter((line, index) => line.trim() !== "*" || (index > 0 && purpose[index - 1].trim() !== "*"));
  while (trimmed.length && trimmed[0].trim() === "*") trimmed.shift();
  while (trimmed.length && trimmed.at(-1)!.trim() === "*") trimmed.pop();
  const rebuilt = [
    ...trimmed, ...(trimmed.length ? [" *"] : []),
    " * Public API:", ...expectedApi.map(entry => ` * - ${entry}`),
    ...(expectedFileCallers.length ? [" *", " * Callers:", ...expectedFileCallers.map(entry => ` * - ${entry}`)] : []),
  ];
  if (rebuilt.join("\n") !== header[2]) {
    if (api?.join() !== expectedApi.join()) report(file, `Public API should be ${expectedApi.join(", ")}`);
    if ((listedCallers ?? []).join() !== expectedFileCallers.join()) report(file, `Callers should be ${expectedFileCallers.join(", ") || "omitted"}`);
    if (!misplaced && api?.join() === expectedApi.join() && (listedCallers ?? []).join() === expectedFileCallers.join()) report(file, "header lists need one entry per line");
    const joined = sourceLines.join("\n");
    return `${header[1]}/**\n${rebuilt.join("\n")}\n */${joined.slice(header[0].length)}`;
  }
  return changed ? sourceLines.join("\n") : null;
}

for (const file of sources) {
  const fixed = checkFile(file);
  if (FIX && fixed !== null) writeFileSync(join(ROOT, file), fixed);
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`${problems.length} header problems${FIX ? " (fixed where possible)" : "; run with --fix to rewrite the lists"}`);
  process.exit(1);
}
console.log(`File headers match the code in ${sources.length} files`);
