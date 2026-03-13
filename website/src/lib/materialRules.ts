/**
 * Public API:
 * - resolveBlockName()
 * - toDisplayName()
 * - resolveShapeColorBlockName()
 *
 * Callers:
 * - src/lib/fillerRules.ts
 * - src/lib/shapeAnalysis.ts
 * - src/lib/shapeSubstitution.ts
 */
import { BASE_COLORS } from "../data/mapColors";
import type { CustomColor } from "./conversionTypes";
import type { ShapeColor } from "./shapeTypes";

// Callers:
// - src/lib/fillerRules.ts
export function resolveBlockName(block: string): string {
  let name: string;
  const props: Record<string, string> = {};

  if (block.includes("[")) {
    const bracketIdx = block.indexOf("[");
    name = block.slice(0, bracketIdx);
    const propsStr = block.slice(bracketIdx + 1, -1);
    for (const part of propsStr.split(",")) {
      const eq = part.indexOf("=");
      if (eq >= 0) props[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  } else {
    name = block;
  }

  if (name.includes("leaves")) props.persistent = "true";

  const fullName = `minecraft:${name}`;
  const propKeys = Object.keys(props);
  return propKeys.length > 0
    ? `${fullName}[${propKeys.map(key => `${key}=${props[key]}`).join(",")}]`
    : fullName;
}

// Callers:
// - src/lib/shapeAnalysis.ts
export function toDisplayName(blockName: string): string {
  const stripped = blockName.replace(/^minecraft:/, "");
  if (!stripped.includes("[")) return stripped;
  const bracketIdx = stripped.indexOf("[");
  const name = stripped.slice(0, bracketIdx);
  const props = stripped.slice(bracketIdx + 1, -1).split(",").filter(part => part.trim() !== "persistent=true");
  return props.length > 0 ? `${name}[${props.join(",")}]` : name;
}

// Callers:
// - src/lib/shapeAnalysis.ts
// - src/lib/shapeSubstitution.ts
export function resolveShapeColorBlockName(
  color: ShapeColor,
  options: { blockMapping: Record<number, string>; customColors: CustomColor[] },
): string | null {
  if (color.isCustom) {
    const block = options.customColors[color.id]?.block ?? "";
    return block ? resolveBlockName(block) : null;
  }
  const mapped = options.blockMapping[color.id] || BASE_COLORS[color.id].blocks[0];
  return mapped ? resolveBlockName(mapped) : null;
}
