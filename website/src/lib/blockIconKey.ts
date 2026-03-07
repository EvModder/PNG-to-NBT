export function normalizeBlockEntry(entry: string): string {
  return entry.trim().replace(/^minecraft:/, "");
}

export function toBlockIconKey(raw: string): string {
  return normalizeBlockEntry(raw)
    .replace(/__/g, "__us__")
    .replace(/\[/g, "__lb__")
    .replace(/\]/g, "__rb__")
    .replace(/=/g, "__eq__")
    .replace(/,/g, "__cm__")
    .replace(/:/g, "__cl__");
}

