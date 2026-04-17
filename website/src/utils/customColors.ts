/**
 * Public API:
 * - getSelectedCustomColorBlock()
 * - cloneCustomColors()
 * - normalizeCustomSelectedBlocks()
 * - areCustomColorsEqual()
 * - areCustomSelectedBlocksEqual()
 * - sanitizeCustomRgbDraftValue()
 * - findMatchingBaseColorIndex()
 * - buildCustomBlocksByBase()
 * - upsertCustomColorBlock()
 * - selectCustomColorBlock()
 * - removeCustomColorBlock()
 * - getParseRelevantCustomColorsKey()
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/lib/blockId.ts
 * - src/lib/codecPreset.ts
 * - src/lib/colorGridParsingCore.ts
 * - tests/run.mts
 */
import { BASE_COLORS } from "@/data/mapColors";
import type { ColorRgb } from "@/types/color";

// Callers:
// - src/Index.tsx
// - src/components/PanelCustomColors.tsx
// - src/lib/blockId.ts
// - src/lib/codecPreset.ts
export function getSelectedCustomColorBlock(
  selectedBlocksCustom: Readonly<Record<number, string>> | undefined,
  customIndex: number,
  customColors: readonly ColorRgb[],
): string {
  const color = customColors[customIndex];
  if (!color) return "";
  const selectedBlock = selectedBlocksCustom?.[customIndex];
  if (selectedBlock === undefined) return color.blocks[0] ?? "";
  if (selectedBlock === "") return "";
  return color.blocks.includes(selectedBlock) ? selectedBlock : "";
}

function cloneCustomColor(color: ColorRgb): ColorRgb {
  const blocks = color.blocks.filter(block => block.trim() !== "");
  return {
    r: color.r,
    g: color.g,
    b: color.b,
    blocks: [...blocks],
  };
}

// Callers:
// - src/components/PanelCustomColors.tsx
// - src/lib/colorGridParsingCore.ts
export function findMatchingBaseColorIndex(color: Pick<ColorRgb, "r" | "g" | "b">): number | null {
  const baseIndex = BASE_COLORS.findIndex(base => base.r === color.r && base.g === color.g && base.b === color.b);
  return baseIndex >= 0 ? baseIndex : null;
}

// Callers:
// - src/Index.tsx
export function cloneCustomColors(customColors: readonly ColorRgb[]): ColorRgb[] {
  return customColors.map(cloneCustomColor);
}

// Callers:
// - src/Index.tsx
export function buildCustomBlocksByBase(customColors: readonly ColorRgb[]): Record<number, string[]> {
  const blocksByBase: Record<number, string[]> = {};
  for (const color of customColors) {
    const baseIndex = findMatchingBaseColorIndex(color);
    if (baseIndex === null) continue;
    const blocks = (blocksByBase[baseIndex] ??= []);
    for (const block of color.blocks) {
      if (!blocks.includes(block)) blocks.push(block);
    }
  }
  return blocksByBase;
}

// Callers:
// - src/Index.tsx
// - tests/run.mts
export function normalizeCustomSelectedBlocks(
  customColors: readonly ColorRgb[],
  selectedBlocksCustom?: Readonly<Record<number, string>>,
): Record<number, string> {
  return Object.fromEntries(
    customColors.map((color, customIndex) => {
      const selectedBlock = selectedBlocksCustom?.[customIndex];
      if (selectedBlock === undefined) return [customIndex, color.blocks[0] ?? ""];
      if (selectedBlock === "") return [customIndex, ""];
      return [customIndex, color.blocks.includes(selectedBlock) ? selectedBlock : ""];
    }),
  );
}

// Callers:
// - src/Index.tsx
export function areCustomColorsEqual(
  left: readonly ColorRgb[] | undefined,
  right: readonly ColorRgb[] | undefined,
): boolean {
  const leftColors = left ?? [];
  const rightColors = right ?? [];
  return leftColors.length === rightColors.length && leftColors.every((leftColor, index) => {
    const rightColor = rightColors[index];
    return !!rightColor &&
      leftColor.r === rightColor.r &&
      leftColor.g === rightColor.g &&
      leftColor.b === rightColor.b &&
      leftColor.blocks.length === rightColor.blocks.length &&
      leftColor.blocks.every((block, blockIndex) => block === rightColor.blocks[blockIndex]);
  });
}

// Callers:
// - src/Index.tsx
export function areCustomSelectedBlocksEqual(
  left: Readonly<Record<number, string>> | undefined,
  right: Readonly<Record<number, string>> | undefined,
  customColors: readonly ColorRgb[],
): boolean {
  const leftSelections = normalizeCustomSelectedBlocks(customColors, left);
  const rightSelections = normalizeCustomSelectedBlocks(customColors, right);
  return customColors.every((_, index) => leftSelections[index] === rightSelections[index]);
}

// Callers:
// - src/Index.tsx
export function sanitizeCustomRgbDraftValue(raw: string): string {
  const digitsOnly = raw.replace(/\D/g, "");
  if (!digitsOnly) return "";
  return String(Math.min(255, Number.parseInt(digitsOnly, 10)));
}

// Callers:
// - src/Index.tsx
export function upsertCustomColorBlock(
  customColors: readonly ColorRgb[],
  selectedBlocksCustom: Readonly<Record<number, string>>,
  color: Pick<ColorRgb, "r" | "g" | "b">,
  block: string,
): { customColors: readonly ColorRgb[]; selectedBlocksCustom: Record<number, string>; added: boolean } {
  const existingIndex = customColors.findIndex(existing =>
    existing.r === color.r && existing.g === color.g && existing.b === color.b,
  );
  if (existingIndex < 0) {
    return {
      added: true,
      customColors: [...customColors, { ...color, blocks: [block] }],
      selectedBlocksCustom: { ...selectedBlocksCustom, [customColors.length]: block },
    };
  }

  const existing = customColors[existingIndex];
  if (existing.blocks.includes(block)) {
    return { added: false, customColors, selectedBlocksCustom: { ...selectedBlocksCustom } };
  }

  const nextCustomColors = cloneCustomColors(customColors);
  nextCustomColors[existingIndex] = {
    ...existing,
    blocks: [...existing.blocks, block],
  };
  return {
    added: true,
    customColors: nextCustomColors,
    selectedBlocksCustom: { ...selectedBlocksCustom },
  };
}

// Callers:
// - src/Index.tsx
export function selectCustomColorBlock(
  customColors: readonly ColorRgb[],
  selectedBlocksCustom: Readonly<Record<number, string>>,
  customIndex: number,
  block: string,
): { customColors: readonly ColorRgb[]; selectedBlocksCustom: Record<number, string> } {
  const existing = customColors[customIndex];
  if (!existing) return { customColors, selectedBlocksCustom: { ...selectedBlocksCustom } };
  if (block !== "" && !existing.blocks.includes(block)) {
    return { customColors, selectedBlocksCustom: { ...selectedBlocksCustom } };
  }
  const currentBlock = getSelectedCustomColorBlock(selectedBlocksCustom, customIndex, customColors);
  if (currentBlock === block) return { customColors, selectedBlocksCustom: { ...selectedBlocksCustom } };
  return {
    customColors,
    selectedBlocksCustom: { ...selectedBlocksCustom, [customIndex]: block },
  };
}

// Callers:
// - src/Index.tsx
export function removeCustomColorBlock(
  customColors: readonly ColorRgb[],
  selectedBlocksCustom: Readonly<Record<number, string>>,
  customIndex: number,
  block: string,
): { customColors: readonly ColorRgb[]; selectedBlocksCustom: Record<number, string> } {
  const existing = customColors[customIndex];
  if (!existing || !existing.blocks.includes(block)) {
    return { customColors, selectedBlocksCustom: normalizeCustomSelectedBlocks(customColors, selectedBlocksCustom) };
  }

  const normalizedSelections = normalizeCustomSelectedBlocks(customColors, selectedBlocksCustom);
  const nextBlocks = existing.blocks.filter(option => option !== block);
  if (nextBlocks.length === 0) {
    const nextSelectedBlocksCustom: Record<number, string> = {};
    customColors.forEach((_, index) => {
      if (index === customIndex) return;
      const nextIndex = index > customIndex ? index - 1 : index;
      nextSelectedBlocksCustom[nextIndex] = normalizedSelections[index] ?? "";
    });
    return {
      customColors: cloneCustomColors(customColors.filter((_, index) => index !== customIndex)),
      selectedBlocksCustom: nextSelectedBlocksCustom,
    };
  }

  const nextCustomColors = cloneCustomColors(customColors);
  nextCustomColors[customIndex] = {
    ...existing,
    blocks: nextBlocks,
  };
  const nextSelectedBlocksCustom = { ...normalizedSelections };
  if (getSelectedCustomColorBlock(normalizedSelections, customIndex, customColors) === block) {
    nextSelectedBlocksCustom[customIndex] = "";
  }
  return {
    customColors: nextCustomColors,
    selectedBlocksCustom: nextSelectedBlocksCustom,
  };
}

// Callers:
// - src/Index.tsx
export function getParseRelevantCustomColorsKey(customColors: readonly ColorRgb[]): string {
  return customColors
    .flatMap((color, customIndex) =>
      findMatchingBaseColorIndex(color) === null
        ? [`${customIndex}=${color.r},${color.g},${color.b}`]
        : [],
    )
    .join("|");
}
