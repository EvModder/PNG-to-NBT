/**
 * Public API:
 * - toBlockIconKey()
 * - getBlockIconAtlasEntry()
 *
 * Callers:
 * - src/Index.tsx
 */
import { BLOCK_ICON_ATLASES, type BlockIconAtlasName } from "@/data/blockIconAtlases";

interface BlockIconAtlasEntry {
  atlasSrc: string;
  columns: number;
  rows: number;
  col: number;
  row: number;
}

// Callers:
// - src/Index.tsx
export function toBlockIconKey(raw: string): string {
  return raw
    .replace(/^minecraft:/i, "")
    .replace(/__/g, "__us__")
    .replace(/\[/g, "__lb__")
    .replace(/\]/g, "__rb__")
    .replace(/=/g, "__eq__")
    .replace(/,/g, "__cm__")
    .replace(/:/g, "__cl__");
}

// Callers:
// - src/Index.tsx
export function getBlockIconAtlasEntry(
  atlasName: BlockIconAtlasName,
  iconKey: string,
): BlockIconAtlasEntry | null {
  const atlas = BLOCK_ICON_ATLASES[atlasName];
  const index = atlas.entries[iconKey];
  if (index === undefined) return null;

  const col = index % atlas.columns;
  const row = Math.floor(index / atlas.columns);
  return {
    atlasSrc: atlas.src,
    columns: atlas.columns,
    rows: atlas.rows,
    col,
    row,
  };
}
