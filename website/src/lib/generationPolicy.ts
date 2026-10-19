/**
 * Shared generation policy, independent of UI state and storage.
 *
 * Public API:
 * - WATER_DROP_INPUT_ORDER
 * - WaterDropShade
 * - CRUBTECH_WATER_DROPS
 * - normalizeUsedWaterDrops()
 * - getUsedWaterShades()
 * - resolveTileWaterSetting()
 * - getFlatBuildAtWorldMinYEligible()
 * - getBuildAtWorldMinYEligibleForBuildMode()
 * - getShapeForBuildMode()
 * - getPaletteSeedOffset()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/tileGeometry.ts
 */
import { DEFAULT_CRUBTECH_DARK_WATER_DROP, DEFAULT_CRUBTECH_FLAT_WATER_DROP, DEFAULT_CRUBTECH_LIGHT_WATER_DROP } from "@/data/defaultSettings";
import { BASE_COLORS, WATER_BASE_INDEX } from "@/data/mapColors";
import { Shade, type ColorGrid } from "@/types/color";
import { BuildMode } from "@/types/conversion";
import type { GeneratedShape } from "@/types/shape";
import { isCrubTechBuildMode, isStaircaseBuildMode } from "@/utils/conversion";
import { FlatModeBehavior, type WaterDrops, type deriveImageStats } from "./colorGridAnalysis";
import { getColorRefKey, type ColorRefKey } from "./colorRefs";
import { hasBuildAtWorldMinYOpportunity } from "./shapeAnalysis";
import type { TileBaseGeometryWorkerResult, TileWaterSetting } from "./tileGeometryWorkerTypes";

type TileBaseAnalysis = TileBaseGeometryWorkerResult & {
  tile: { colorGrid: ColorGrid };
  flatModeBehavior: FlatModeBehavior;
};
const EMPTY_USED_WATER_SHADES: ReadonlySet<Shade> = new Set();
export const WATER_DROP_INPUT_ORDER = [Shade.Light, Shade.Flat, Shade.Dark] as const;
export type WaterDropShade = typeof WATER_DROP_INPUT_ORDER[number];
export const CRUBTECH_WATER_DROPS = [
  DEFAULT_CRUBTECH_DARK_WATER_DROP,
  DEFAULT_CRUBTECH_FLAT_WATER_DROP,
  DEFAULT_CRUBTECH_LIGHT_WATER_DROP,
] as const satisfies WaterDrops;
const CRUBTECH_SHAPE_WATER_DROPS = CRUBTECH_WATER_DROPS.map(drop => drop + 1) as [...WaterDrops];

const STAIRCASE_DEDUP_FALLBACK_ORDER = [
  BuildMode.StaircaseNorthline,
  BuildMode.StaircaseSouthline,
  BuildMode.StaircaseClassic,
  BuildMode.StaircaseValley,
  BuildMode.StaircaseGroup,
  BuildMode.StaircaseParty,
] as const satisfies readonly BuildMode[];

// Callers:
// - src/Index.tsx
// - src/lib/tileGeometry.ts
export function getShapeForBuildMode(
  shapeMap: Partial<Record<BuildMode, GeneratedShape>>,
  buildMode: BuildMode,
  isFlatShape: boolean,
): GeneratedShape | null {
  if (buildMode === BuildMode.Flat) return isFlatShape ? (shapeMap[BuildMode.StaircaseNorthline] ?? null) : null;
  const direct = shapeMap[buildMode] ?? null;
  if (direct) return direct;
  if (!isStaircaseBuildMode(buildMode)) return null;
  const inclineFallback = shapeMap[BuildMode.InclineUp] ?? shapeMap[BuildMode.InclineDown] ?? null;
  if (inclineFallback) return inclineFallback;
  const buildModeIndex = STAIRCASE_DEDUP_FALLBACK_ORDER.indexOf(buildMode as typeof STAIRCASE_DEDUP_FALLBACK_ORDER[number]);
  if (buildModeIndex < 0) return null;
  for (let i = buildModeIndex - 1; i >= 0; --i) {
    const fallback = shapeMap[STAIRCASE_DEDUP_FALLBACK_ORDER[i]];
    if (fallback) return fallback;
  }
  return null;
}

function hashString32(input: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; ++i) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

// Callers:
// - src/Index.tsx
export function getPaletteSeedOffset(blockMapping: Record<number, string>): number {
  const serialized = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => `${i + 1}:${blockMapping[i + 1] ?? ""}`).join("|");
  return hashString32(serialized);
}

export function normalizeUsedWaterDrops(
  rawDrops: Record<WaterDropShade, number>,
  usedWaterShades: ReadonlySet<Shade>,
  preferredFirstShade?: WaterDropShade,
): readonly [dark: number, flat: number, light: number] {
  const next: [number, number, number] = [
    Math.max(0, rawDrops[Shade.Dark] || 0),
    Math.max(0, rawDrops[Shade.Flat] || 0),
    Math.max(0, rawDrops[Shade.Light] || 0),
  ];
  const usedValues = new Set<number>();
  const orderedShades = preferredFirstShade === undefined
    ? WATER_DROP_INPUT_ORDER
    : [preferredFirstShade, ...WATER_DROP_INPUT_ORDER.filter(shade => shade !== preferredFirstShade)];

  for (const shade of orderedShades) {
    if (!usedWaterShades.has(shade)) continue;
    let value = next[shade];
    while (usedValues.has(value)) ++value;
    next[shade] = value;
    usedValues.add(value);
  }

  return next;
}

export function getUsedWaterShades(
  usedShadesByColorKey: ReadonlyMap<ColorRefKey, ReadonlySet<Shade>>,
): ReadonlySet<Shade> {
  return usedShadesByColorKey.get(getColorRefKey({ id: WATER_BASE_INDEX, isCustom: false })) ?? EMPTY_USED_WATER_SHADES;
}

export function resolveTileWaterSetting(
  stats: ReturnType<typeof deriveImageStats>,
  mode: BuildMode,
  belowPlatformWater: boolean,
  crubTech: boolean,
  usesWaterForWater: boolean,
  drops: WaterDrops,
): TileWaterSetting {
  const shades = getUsedWaterShades(stats.usedShadesByColorKey);
  const crubTechWater = crubTech && isCrubTechBuildMode(mode);
  if ((belowPlatformWater || crubTechWater) && shades.size > 0) {
    return { kind: "below-platform", drops: crubTechWater ? CRUBTECH_SHAPE_WATER_DROPS : drops };
  }
  // Preserve leaf/ice staircase convenience placement outside flat land.
  if ((shades.has(Shade.Dark) || shades.has(Shade.Flat)) && (usesWaterForWater || stats.hasOnlyFlatLand)) {
    return { kind: "top-aligned" };
  }
  return undefined;
}

export function getFlatBuildAtWorldMinYEligible(
  tileBaseAnalyses: readonly TileBaseAnalysis[],
  applySupportFloorYs: boolean,
): boolean {
  return tileBaseAnalyses.some(tile =>
    tile.flatModeBehavior === FlatModeBehavior.ToggleableBuildAtWorldMinY &&
    !!tile.baseNorthlineShape &&
    hasBuildAtWorldMinYOpportunity(tile.tile.colorGrid, tile.baseNorthlineShape, applySupportFloorYs),
  );
}

export function getBuildAtWorldMinYEligibleForBuildMode(
  tileBaseAnalyses: readonly TileBaseAnalysis[],
  buildMode: BuildMode,
  applySupportFloorYs: boolean,
): boolean {
  if (!isStaircaseBuildMode(buildMode)) return false;
  if (buildMode === BuildMode.Flat) {
    return getFlatBuildAtWorldMinYEligible(tileBaseAnalyses, applySupportFloorYs);
  }
  return tileBaseAnalyses.some(tile => {
    const shape = getShapeForBuildMode(tile.baseShapeMap, buildMode, tile.isFlatShape);
    return !!shape && hasBuildAtWorldMinYOpportunity(tile.tile.colorGrid, shape, applySupportFloorYs);
  });
}
