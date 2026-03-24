/**
 * Public API:
 * - encodeFullPreset()
 * - decodeFullPreset()
 *
 * Callers:
 * - src/Index.tsx
 */
import { BASE_COLORS } from "@/data/mapColors";
import { type BlockPreset } from "@/data/presets";
import type { ColorRgbCustom } from "@/types/color";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { isSuppressStepDirection } from "@/utils/conversion";
import { SupportMode } from "@/types/ui";

interface FullPreset {
  blockPreset: BlockPreset;
  supportFiller?: string;
  shadeFiller?: string;
  supportMode?: SupportMode;
  buildMode?: BuildMode;
  customColors?: ColorRgbCustom[];
  convertUnsupported?: boolean;
  suppress2LayerLateFillerBlock?: string;
  proPaletteSeed?: boolean;
  mixSteps?: boolean;
  buildAtWorldMinY?: boolean;
  suppressStepDirection?: SuppressStepDirection;
  dominateVoidFillerBlock?: string;
  recessiveVoidFillerBlock?: string;
}

// Callers:
// - src/Index.tsx
export function encodeFullPreset(
  preset: BlockPreset, supportFillerBlock: string, shadeFillerBlock: string, supportMode: SupportMode,
  buildMode: BuildMode, customColors: ColorRgbCustom[], convertUnsupported: boolean,
  suppress2LayerLateFillerBlock: string, proPaletteSeed: boolean, mixSteps: boolean, buildAtWorldMinY: boolean, suppressStepDirection: SuppressStepDirection,
  dominateVoidFillerBlock: string, recessiveVoidFillerBlock: string,
): string {
  const parts = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => {
    const block = preset.blocks[i + 1] || "";
    const idx = BASE_COLORS[i + 1].blocks.indexOf(block);
    return idx >= 0 ? String(idx) : block ? `=${block}` : "-";
  });
  const customColorString = customColors.length > 0
    ? customColors.map(color => `${color.r},${color.g},${color.b}:${color.blocks.map(encodeURIComponent).join(",")}`).join(";")
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
    suppressStepDirection,
  ].join("|");
  return btoa(serialized).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// Callers:
// - src/Index.tsx
export function decodeFullPreset(encoded: string): FullPreset | null {
  try {
    let serialized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (serialized.length % 4) serialized += "=";
    const sections = atob(serialized).split("|");
    if (sections.length < 2) return null;

    const supportMode = (sections[4] || SupportMode.None) as SupportMode;

    const blocks: Record<number, string> = {};
    for (const [i, part] of sections[1].split(",").entries()) {
      if (i >= BASE_COLORS.length - 1) break;
      const baseIndex = i + 1;
      blocks[baseIndex] =
        part === "-" || part === ""
          ? ""
          : part.startsWith("=")
            ? part.slice(1)
            : BASE_COLORS[baseIndex].blocks[parseInt(part)] || "";
    }

    const customColors = sections[6]
      ? sections[6]
          .split(";")
          .map(entry => {
            const [rgb, encodedBlocks] = entry.split(":");
            const [r, g, b] = rgb.split(",").map(Number);
            return {
              r,
              g,
              b,
              blocks: (encodedBlocks || "")
                .split(",")
                .filter(block => block !== "")
                .map(block => decodeURIComponent(block)),
            };
          })
          .filter(color => !isNaN(color.r) && color.blocks.length > 0)
      : undefined;

    const convertUnsupported = sections[7] === "1" ? true : sections[7] === "0" ? false : undefined;
    const suppress2LayerLateFillerBlock = sections[8] || undefined;
    const proPaletteSeed = sections[9] === "1" ? true : sections[9] === "0" ? false : undefined;
    const dominateVoidFillerBlock = sections[10] || undefined;
    const recessiveVoidFillerBlock = sections[11] || undefined;
    const mixSteps = sections[12] === "1" ? true : sections[12] === "0" ? false : undefined;
    const buildAtWorldMinY = sections[13] === "1" ? true : sections[13] === "0" ? false : undefined;
    const suppressStepDirection = sections[14] && isSuppressStepDirection(sections[14]) ? sections[14] : undefined;

    return {
      blockPreset: { name: sections[0], blocks },
      supportFiller: sections[2] || undefined,
      shadeFiller: sections[3] || undefined,
      supportMode,
      buildMode: Object.values(BuildMode).includes(sections[5] as BuildMode) ? sections[5] as BuildMode : undefined,
      customColors,
      convertUnsupported,
      proPaletteSeed,
      mixSteps,
      buildAtWorldMinY,
      suppressStepDirection,
      suppress2LayerLateFillerBlock: suppress2LayerLateFillerBlock || undefined,
      dominateVoidFillerBlock: dominateVoidFillerBlock || undefined,
      recessiveVoidFillerBlock: recessiveVoidFillerBlock || undefined,
    };
  } catch {
    return null;
  }
}
