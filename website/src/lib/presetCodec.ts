/**
 * Public API:
 * - FullPreset
 * - encodeFullPreset()
 * - decodeFullPreset()
 *
 * Callers:
 * - src/Index.tsx
 */
import { BASE_COLORS } from "@/data/mapColors";
import { type BlockPreset } from "@/data/presets";
import { canonicalizeBlockEntry } from "@/lib/blockId";
import { BuildMode, SuppressStepDirection, type CustomColor, isSuppressStepDirection } from "@/lib/conversionTypes";
import { SupportMode } from "@/lib/uiTypes";

export interface FullPreset {
  blockPreset: BlockPreset;
  supportFiller?: string;
  shadeFiller?: string;
  supportMode?: SupportMode;
  buildMode?: BuildMode;
  customColors?: CustomColor[];
  convertUnsupported?: boolean;
  suppress2LayerLateFillerBlock?: string;
  proPaletteSeed?: boolean;
  mixSteps?: boolean;
  suppressStepDirection?: SuppressStepDirection;
  dominateVoidFillerBlock?: string;
  recessiveVoidFillerBlock?: string;
}

function isBuildMode(raw: unknown): raw is BuildMode {
  return Object.values(BuildMode).includes(raw as BuildMode);
}

export function encodeFullPreset(
  preset: BlockPreset, supportFillerBlock: string, shadeFillerBlock: string, supportMode: SupportMode,
  buildMode: BuildMode, customColors: CustomColor[], convertUnsupported: boolean,
  suppress2LayerLateFillerBlock: string, proPaletteSeed: boolean, mixSteps: boolean, suppressStepDirection: SuppressStepDirection,
  dominateVoidFillerBlock: string, recessiveVoidFillerBlock: string,
): string {
  const parts = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => {
    const block = canonicalizeBlockEntry(preset.blocks[i + 1] || "");
    const idx = BASE_COLORS[i + 1].blocks.indexOf(block);
    return idx >= 0 ? String(idx) : block ? `=${block}` : "-";
  });
  const customColorString = customColors.length > 0
    ? customColors.map(color => `${color.r},${color.g},${color.b}:${canonicalizeBlockEntry(color.block)}`).join(";")
    : "";
  const serialized = [
    preset.name,
    parts.join(","),
    canonicalizeBlockEntry(supportFillerBlock),
    canonicalizeBlockEntry(shadeFillerBlock),
    supportMode,
    buildMode,
    customColorString,
    convertUnsupported ? "1" : "0",
    canonicalizeBlockEntry(suppress2LayerLateFillerBlock),
    proPaletteSeed ? "1" : "0",
    canonicalizeBlockEntry(dominateVoidFillerBlock),
    canonicalizeBlockEntry(recessiveVoidFillerBlock),
    mixSteps ? "1" : "0",
    suppressStepDirection,
  ].join("|");
  return btoa(serialized).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function decodeFullPreset(encoded: string): FullPreset | null {
  try {
    let serialized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (serialized.length % 4) serialized += "=";
    const sections = atob(serialized).split("|");
    if (sections.length < 2) return null;

    const supportRaw = sections[4] || SupportMode.None;
    const supportMode: SupportMode =
      supportRaw === "1" ? SupportMode.Steps : supportRaw === "0" ? SupportMode.None : (supportRaw as SupportMode);

    const blocks: Record<number, string> = {};
    for (const [i, part] of sections[1].split(",").entries()) {
      if (i >= BASE_COLORS.length - 1) break;
      const baseIndex = i + 1;
      blocks[baseIndex] =
        part === "-" || part === ""
          ? ""
          : part.startsWith("=")
            ? canonicalizeBlockEntry(part.slice(1))
            : BASE_COLORS[baseIndex].blocks[parseInt(part)] || "";
    }

    const customColors = sections[6]
      ? sections[6]
          .split(";")
          .map(entry => {
            const [rgb, block] = entry.split(":");
            const [r, g, b] = rgb.split(",").map(Number);
            return { r, g, b, block: canonicalizeBlockEntry(block || "") };
          })
          .filter(color => !isNaN(color.r) && color.block)
      : undefined;

    const convertUnsupported = sections[7] === "1" ? true : sections[7] === "0" ? false : undefined;
    const suppress2LayerLateFillerBlock = sections[8] || undefined;
    const proPaletteSeed = sections[9] === "1" ? true : sections[9] === "0" ? false : undefined;
    const dominateVoidFillerBlock = sections[10] || undefined;
    const recessiveVoidFillerBlock = sections[11] || undefined;
    const mixSteps = sections[12] === "1" ? true : sections[12] === "0" ? false : undefined;
    const suppressStepDirection =
      sections[13] && isSuppressStepDirection(sections[13])
        ? sections[13]
        : undefined;

    return {
      blockPreset: { name: sections[0], blocks },
      supportFiller: sections[2] ? canonicalizeBlockEntry(sections[2]) : undefined,
      shadeFiller: sections[3] ? canonicalizeBlockEntry(sections[3]) : undefined,
      supportMode,
      buildMode: isBuildMode(sections[5]) ? sections[5] : undefined,
      customColors,
      convertUnsupported,
      proPaletteSeed,
      mixSteps,
      suppressStepDirection,
      suppress2LayerLateFillerBlock: suppress2LayerLateFillerBlock ? canonicalizeBlockEntry(suppress2LayerLateFillerBlock) : undefined,
      dominateVoidFillerBlock: dominateVoidFillerBlock ? canonicalizeBlockEntry(dominateVoidFillerBlock) : undefined,
      recessiveVoidFillerBlock: recessiveVoidFillerBlock ? canonicalizeBlockEntry(recessiveVoidFillerBlock) : undefined,
    };
  } catch {
    return null;
  }
}
