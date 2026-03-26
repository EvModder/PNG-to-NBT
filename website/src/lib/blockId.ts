/**
 * Public API:
 * - stripDefaultBlockNamespace()
 * - normalizeBlockId()
 * - sanitizeUserBlockEntry()
 * - resolveExportBlockName()
 * - toDisplayName()
 * - resolveShapeColorBlockName()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/blockIconAtlas.ts
 * - src/lib/fillerRules.ts
 * - src/lib/nbtExport.ts
 * - src/lib/presetCodec.ts
 * - src/lib/previewImageEdits.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeModel.ts
 * - tests/run.mts
 */
import { BASE_COLORS } from "@/data/mapColors";
import type { ColorRef, ColorRgbCustom } from "@/types/color";

const DEFAULT_NAMESPACE = "minecraft:";

// Callers:
// - src/lib/blockIconAtlas.ts
// - src/lib/blockId.ts
export function stripDefaultBlockNamespace(raw: string): string {
  return raw.trim().replace(/^minecraft:/i, "");
}

// Callers:
// - src/Index.tsx
// - src/lib/fillerRules.ts
// - src/lib/previewImageEdits.ts
// - src/lib/shapeModel.ts
// - tests/run.mts
export function normalizeBlockId(raw: string): string {
  return stripDefaultBlockNamespace(raw).toLowerCase().split("[")[0];
}

// Callers:
// - src/Index.tsx
// - src/lib/presetCodec.ts
// - tests/run.mts
export function sanitizeUserBlockEntry(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const bracketIdx = trimmed.indexOf("[");
  if (bracketIdx < 0 || !trimmed.endsWith("]")) return stripDefaultBlockNamespace(trimmed).toLowerCase();

  const name = stripDefaultBlockNamespace(trimmed.slice(0, bracketIdx)).toLowerCase();
  const props = trimmed
    .slice(bracketIdx + 1, -1)
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  if (!normalizeBlockId(name).endsWith("_log")) {
    return props.length > 0 ? `${name}[${props.join(",")}]` : name;
  }

  const filteredProps = props.filter(part => part.toLowerCase() !== "axis=y");
  return filteredProps.length > 0 ? `${name}[${filteredProps.join(",")}]` : name;
}

// Callers:
// - src/lib/fillerRules.ts
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export function resolveExportBlockName(block: string): string {
  const bracketIdx = block.indexOf("[");
  const name = bracketIdx < 0 ? block : block.slice(0, bracketIdx);
  const fullName = name.includes(":") ? name : `${DEFAULT_NAMESPACE}${name}`;
  const isLeavesBlock = stripDefaultBlockNamespace(name).includes("leaves");
  if (!isLeavesBlock) {
    return bracketIdx < 0 ? fullName : `${fullName}${block.slice(bracketIdx)}`;
  }

  if (bracketIdx < 0) return `${fullName}[persistent=true]`;

  const props: string[] = [];
  let hasPersistent = false;
  for (const part of block.slice(bracketIdx + 1, -1).split(",")) {
    const trimmedPart = part.trim();
    if (!trimmedPart) continue;
    const eq = trimmedPart.indexOf("=");
    if (eq < 0) continue;
    const key = trimmedPart.slice(0, eq).trim();
    const value = trimmedPart.slice(eq + 1).trim();
    if (key === "persistent") {
      props.push("persistent=true");
      hasPersistent = true;
      continue;
    }
    props.push(`${key}=${value}`);
  }
  if (!hasPersistent) props.push("persistent=true");
  return `${fullName}[${props.join(",")}]`;
}

// Callers:
// - src/lib/shapeAnalysis.ts
export function toDisplayName(blockName: string): string {
  const stripped = stripDefaultBlockNamespace(blockName);
  if (!stripped.includes("[")) return stripped;
  const bracketIdx = stripped.indexOf("[");
  const name = stripped.slice(0, bracketIdx);
  const props = stripped.slice(bracketIdx + 1, -1).split(",").filter(part => part.trim() !== "persistent=true");
  return props.length > 0 ? `${name}[${props.join(",")}]` : name;
}

// Callers:
// - src/lib/nbtExport.ts
// - src/lib/shapeAnalysis.ts
export function resolveShapeColorBlockName(
  color: ColorRef,
  options: { blockMapping: Record<number, string>; customColors: ColorRgbCustom[] },
): string | null {
  if (color.isCustom) {
    const block = options.customColors[color.id]?.blocks[0] ?? "";
    return block ? resolveExportBlockName(block) : null;
  }
  const mapped = options.blockMapping[color.id] || BASE_COLORS[color.id].blocks[0];
  return mapped ? resolveExportBlockName(mapped) : null;
}
