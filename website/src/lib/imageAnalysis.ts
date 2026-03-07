import { SHADE_MULTIPLIERS, WATER_BASE_INDEX, getColorLookup } from "@/data/mapColors";
import type { CustomColor } from "@/lib/converter";

interface CustomShadeMatch {
  block: string;
  shade: number; // 0=dark, 1=flat, 2=light
  customIndex: number;
}

const MAP_SIZE = 128;

const colorKey = (r: number, g: number, b: number): string => `${r},${g},${b}`;

export function buildCustomShadeLookup(customColors: CustomColor[]): Map<string, CustomShadeMatch> {
  const lookup = new Map<string, CustomShadeMatch>();
  for (const [customIndex, cc] of customColors.entries()) {
    const block = cc.block?.trim();
    if (!block) continue;
    for (const shade of [0, 1, 2] as const) {
      const r = Math.floor((cc.r * SHADE_MULTIPLIERS[shade]) / 255);
      const g = Math.floor((cc.g * SHADE_MULTIPLIERS[shade]) / 255);
      const b = Math.floor((cc.b * SHADE_MULTIPLIERS[shade]) / 255);
      const key = colorKey(r, g, b);
      if (!lookup.has(key)) lookup.set(key, { block, shade, customIndex });
    }
  }
  return lookup;
}

export function imageHasNonFlatShades(imageData: ImageData, customColors: CustomColor[]): boolean {
  const lookup = getColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = colorKey(d[i], d[i + 1], d[i + 2]);
    const customMatch = customLookup.get(key);
    if (customMatch) {
      if (customMatch.shade !== 1) return true;
      continue;
    }
    const match = lookup.get(key);
    if (match?.shade !== undefined && match.shade !== 1) return true;
  }
  return false;
}

/** Scan suppress columns; if countMode=true returns count, else returns 0/1 for detect */
export function scanSuppressedPixels(imageData: ImageData, customColors: CustomColor[], countMode: boolean): number {
  const lookup = getColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  let count = 0;
  for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const idx = (z * MAP_SIZE + x) * 4;
      if (imageData.data[idx + 3] !== 0) continue;
      for (let sz = z + 1; sz < MAP_SIZE; ++sz) {
        const sIdx = (sz * MAP_SIZE + x) * 4;
        if (imageData.data[sIdx + 3] === 0) continue;
        const sKey = colorKey(imageData.data[sIdx], imageData.data[sIdx + 1], imageData.data[sIdx + 2]);
        const customMatch = customLookup.get(sKey);
        if (customMatch) {
          if (customMatch.shade === 0) {
            if (!countMode) return 1;
            ++count;
          }
          break;
        }
        const match = lookup.get(sKey);
        if (!match || match.shade === 2) break;
        if (match.shade === 0 || match.shade === 3) {
          if (!countMode) return 1;
          ++count;
        }
        break;
      }
    }
  }
  return count;
}

/** Count pixels whose shade requires a north filler while north is transparent/void inside the 128x128 map area. */
export interface VoidShadowStats {
  total: number;
  dominant: number;
  recessive: number;
}

export function analyzeVoidShadows(imageData: ImageData, customColors: CustomColor[]): VoidShadowStats {
  const lookup = getColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  const stats: VoidShadowStats = { total: 0, dominant: 0, recessive: 0 };

  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const idx = (z * MAP_SIZE + x) * 4;
      if (imageData.data[idx + 3] === 0) continue;

      const northIsTransparent = z > 0 && imageData.data[((z - 1) * MAP_SIZE + x) * 4 + 3] === 0;
      if (!northIsTransparent) continue;

      const key = colorKey(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
      const customMatch = customLookup.get(key);
      if (customMatch) {
        if (customMatch.shade === 2) continue;
      } else {
        const match = lookup.get(key);
        if (!match || match.baseIndex === WATER_BASE_INDEX || match.shade === 2) continue;
      }

      ++stats.total;
      if (((x + (z - 1)) & 1) === 0) ++stats.recessive;
      else ++stats.dominant;
    }
  }

  return stats;
}

export function countVoidShadows(imageData: ImageData, customColors: CustomColor[], detectOnly = false): number {
  const total = analyzeVoidShadows(imageData, customColors).total;
  return detectOnly ? (total > 0 ? 1 : 0) : total;
}

export function computeImageInfo(imageData: ImageData, customColors: CustomColor[]) {
  const lookup = getColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  const usedBaseColors = new Set<number>();
  const usedShades = new Set<string>();
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = colorKey(d[i], d[i + 1], d[i + 2]);
    const customMatch = customLookup.get(key);
    if (customMatch) {
      usedShades.add(`custom:${customMatch.customIndex}:${customMatch.shade}`);
      continue;
    }
    const match = lookup.get(key);
    if (match) {
      usedBaseColors.add(match.baseIndex);
      usedShades.add(`${match.baseIndex}:${match.shade}`);
    }
  }
  return { uniqueShadeCount: usedShades.size, uniqueBaseColorCount: usedBaseColors.size };
}

export function detectUniformNonFlatDirection(
  imageData: ImageData,
  customColors: CustomColor[],
): "all_light" | "all_dark" | "mixed" {
  const lookup = getColorLookup();
  const customLookup = buildCustomShadeLookup(customColors);
  const d = imageData.data;
  let sawNonTransparent = false;
  let allLight = true;
  let allDark = true;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    sawNonTransparent = true;
    const key = colorKey(d[i], d[i + 1], d[i + 2]);
    const customMatch = customLookup.get(key);
    if (customMatch) {
      if (customMatch.shade !== 2) allLight = false;
      if (customMatch.shade !== 0) allDark = false;
      continue;
    }
    const match = lookup.get(key);
    if (!match) continue;
    if (match.shade !== 2) allLight = false;
    if (match.shade !== 0) allDark = false;
  }

  if (!sawNonTransparent) return "mixed";
  if (allLight) return "all_light";
  if (allDark) return "all_dark";
  return "mixed";
}
