/**
 * Public API:
 * - encodeFullPreset()
 * - decodeFullPreset()
 * - loadPresets()
 *
 * Callers:
 * - src/Index.tsx
 */
import { BASE_COLORS } from "@/data/mapColors";
import { STORAGE_KEYS } from "@/data/storageKeys";
import { BUILTIN_PRESET_NAMES, getBuiltinPreset, type BlockPreset } from "@/data/presets";
import type { ColorRgb } from "@/types/color";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { isSuppressStepDirection } from "@/utils/conversion";
import { SupportMode } from "@/types/ui";
import { decodeUrlParamText, encodeUrlParamText } from "@/lib/codecUrlParam";
import { getSelectedCustomColorBlock } from "@/utils/customColors";

interface FullPreset {
  blockPreset: BlockPreset;
  supportFiller?: string;
  shadeFiller?: string;
  crubTechShadeBreakableFillerBlock?: string;
  crubTechShadePushableFillerBlock?: string;
  supportMode?: SupportMode;
  buildMode?: BuildMode;
  customColors?: ColorRgb[];
  selectedBlocksCustom?: Record<number, string>;
  convertUnsupported?: boolean;
  suppress2LayerLateFillerBlock?: string;
  proPaletteSeed?: boolean;
  mixSteps?: boolean;
  buildAtWorldMinY?: boolean;
  crubTechSlimeBar?: boolean;
  suppressStepDirection?: SuppressStepDirection;
  dominateVoidFillerBlock?: string;
  recessiveVoidFillerBlock?: string;
}

function serializeFullPreset(
  preset: BlockPreset, supportFillerBlock: string, shadeFillerBlock: string, supportMode: SupportMode,
  buildMode: BuildMode, customColors: ColorRgb[], selectedBlocksCustom: Readonly<Record<number, string>>, convertUnsupported: boolean,
  suppress2LayerLateFillerBlock: string, proPaletteSeed: boolean, mixSteps: boolean, buildAtWorldMinY: boolean, crubTechSlimeBar: boolean, suppressStepDirection: SuppressStepDirection,
  crubTechShadeBreakableFillerBlock: string, crubTechShadePushableFillerBlock: string,
  dominateVoidFillerBlock: string, recessiveVoidFillerBlock: string,
): string {
  const parts = Array.from({ length: BASE_COLORS.length }, (_, i) => {
    const block = preset.selectedBlocks[i] || "";
    const idx = BASE_COLORS[i].blocks.indexOf(block);
    return idx >= 0 ? String(idx) : block ? `=${block}` : "-";
  });
  const customColorString = customColors.length > 0
    ? customColors
      .map((color, customIndex) => {
        const selectedBlock = encodeURIComponent(getSelectedCustomColorBlock(selectedBlocksCustom, customIndex, customColors));
        const blocks = color.blocks.map(encodeURIComponent).join(",");
        return `${color.r},${color.g},${color.b}:${selectedBlock}:${blocks}`;
      })
      .join(";")
    : "";
  const serialized = [
    preset.name,
    parts.join(","),
    supportFillerBlock,
    shadeFillerBlock,
    supportMode,
    buildMode,
    customColorString,
    convertUnsupported ? "1" : "0",
    suppress2LayerLateFillerBlock,
    proPaletteSeed ? "1" : "0",
    dominateVoidFillerBlock,
    recessiveVoidFillerBlock,
    mixSteps ? "1" : "0",
    buildAtWorldMinY ? "1" : "0",
    crubTechSlimeBar ? "1" : "0",
    suppressStepDirection,
    crubTechShadeBreakableFillerBlock,
    crubTechShadePushableFillerBlock,
  ].join("|");
  return serialized;
}

function parseFullPreset(serialized: string): FullPreset | null {
  const sections = serialized.split("|");
  if (sections.length < 2) return null;

  const supportMode = (sections[4] || SupportMode.None) as SupportMode;
  const customSection = sections[6];

  const blocks = Object.fromEntries(
    sections[1]
      .split(",")
      .slice(0, BASE_COLORS.length)
      .map((part, baseIndex) => [
        baseIndex,
        part === "-" || part === ""
          ? ""
          : part.startsWith("=")
            ? part.slice(1)
            : BASE_COLORS[baseIndex].blocks[Number.parseInt(part, 10)] || "",
      ]),
  );

  const customEntries = customSection
    ? customSection
        .split(";")
        .map(entry => {
          const [rgb, encodedSelectedBlock = "", encodedBlocks = ""] = entry.split(":");
          const [r, g, b] = rgb.split(",").map(Number);
          return {
            r,
            g,
            b,
            selectedBlock: decodeURIComponent(encodedSelectedBlock),
            blocks: encodedBlocks
              .split(",")
              .filter(block => block !== "")
              .map(block => decodeURIComponent(block)),
          };
        })
        .filter(entry => !isNaN(entry.r) && entry.blocks.length > 0)
    : [];
  const customColors = customEntries.length > 0
    ? customEntries.map(({ r, g, b, blocks }) => ({ r, g, b, blocks }))
    : undefined;
  const selectedBlocksCustom = customEntries.length > 0
    ? Object.fromEntries(customEntries.map(({ selectedBlock }, customIndex) => [customIndex, selectedBlock]))
    : undefined;

  const convertUnsupported = sections[7] === "1" ? true : sections[7] === "0" ? false : undefined;
  const proPaletteSeed = sections[9] === "1" ? true : sections[9] === "0" ? false : undefined;
  const mixSteps = sections[12] === "1" ? true : sections[12] === "0" ? false : undefined;
  const buildAtWorldMinY = sections[13] === "1" ? true : sections[13] === "0" ? false : undefined;
  const crubTechSlimeBar = sections[14] === "1" ? true : sections[14] === "0" ? false : undefined;
  const suppressStepDirection = sections[15] && isSuppressStepDirection(sections[15]) ? sections[15] : undefined;

  return {
    blockPreset: { name: sections[0], selectedBlocks: blocks },
    supportFiller: sections[2],
    shadeFiller: sections[3],
    supportMode,
    buildMode: Object.values(BuildMode).includes(sections[5] as BuildMode) ? sections[5] as BuildMode : undefined,
    customColors,
    selectedBlocksCustom,
    convertUnsupported,
    proPaletteSeed,
    mixSteps,
    buildAtWorldMinY,
    crubTechSlimeBar,
    suppressStepDirection,
    suppress2LayerLateFillerBlock: sections[8],
    dominateVoidFillerBlock: sections[10],
    recessiveVoidFillerBlock: sections[11],
    crubTechShadeBreakableFillerBlock: sections[16],
    crubTechShadePushableFillerBlock: sections[17],
  };
}

// Callers:
// - src/Index.tsx
export async function encodeFullPreset(
  preset: BlockPreset, supportFillerBlock: string, shadeFillerBlock: string, supportMode: SupportMode,
  buildMode: BuildMode, customColors: ColorRgb[], selectedBlocksCustom: Readonly<Record<number, string>>, convertUnsupported: boolean,
  suppress2LayerLateFillerBlock: string, proPaletteSeed: boolean, mixSteps: boolean, buildAtWorldMinY: boolean, crubTechSlimeBar: boolean, suppressStepDirection: SuppressStepDirection,
  crubTechShadeBreakableFillerBlock: string, crubTechShadePushableFillerBlock: string,
  dominateVoidFillerBlock: string, recessiveVoidFillerBlock: string,
): Promise<string> {
  return encodeUrlParamText(
    serializeFullPreset(
      preset,
      supportFillerBlock,
      shadeFillerBlock,
      supportMode,
      buildMode,
      customColors,
      selectedBlocksCustom,
      convertUnsupported,
      suppress2LayerLateFillerBlock,
      proPaletteSeed,
      mixSteps,
      buildAtWorldMinY,
      crubTechSlimeBar,
      suppressStepDirection,
      crubTechShadeBreakableFillerBlock,
      crubTechShadePushableFillerBlock,
      dominateVoidFillerBlock,
      recessiveVoidFillerBlock,
    ),
  );
}

// Callers:
// - src/Index.tsx
export async function decodeFullPreset(encoded: string): Promise<FullPreset | null> {
  try {
    const serialized = await decodeUrlParamText(encoded);
    if (!serialized) return null;
    return parseFullPreset(serialized);
  } catch {
    return null;
  }
}

// Callers:
// - src/Index.tsx
export function loadPresets(): BlockPreset[] {
  const builtins = BUILTIN_PRESET_NAMES.flatMap(name => {
    const builtin = getBuiltinPreset(name);
    return builtin ? [builtin] : [];
  });
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.presets);
    if (!raw) return builtins;
    const parsed = JSON.parse(raw) as BlockPreset[];
    return [
      ...builtins,
      ...parsed
        .filter(preset => !getBuiltinPreset(preset.name))
        .map(({ name, selectedBlocks, customColors, selectedBlocksCustom }) => ({
          name,
          selectedBlocks: selectedBlocks ?? {},
          customColors,
          selectedBlocksCustom,
        })),
    ];
  } catch {
    /* ignore */
  }
  return builtins;
}
