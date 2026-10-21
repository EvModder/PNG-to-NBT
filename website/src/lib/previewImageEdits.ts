/**
 * Public API:
 * - PreviewPixelReplacement
 * - PreviewPixelMask
 * - offsetPreviewPixelReplacements()
 * - buildSelectedTileVisibleMask()
 * - getPreviewRangeMax()
 * - collectVsFillerPreviewReplacements()
 * - useStepPreview()
 * - useVsFillerPreviewReplacements()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/previewImageStore.ts
 */
import { useMemo } from "react";
import { BASE_COLORS, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "@/data/mapColors";
import { DEFAULT_MINECRAFT_VERSION } from "@/data/defaultSettings";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { getMinecraftCatalog } from "@/lib/minecraftVersion";
import { normalizeBlockId, toDisplayName, type ColorBlockSelections } from "@/lib/blockId";
import { parseColorRefKey } from "@/lib/colorRefs";
import { Shade, type ColorRef } from "@/types/color";
import { FillerRole, BuildMode, type FillerAssignment } from "@/types/conversion";
import { ShapePartType, type GeneratedShape } from "@/types/shape";
import { buildFillerAssignmentMap, isShadeFillerDisabled } from "@/lib/fillerRules";
import { collectFillerRolePixels, type analyzeMaterialNeeds } from "@/lib/shapeAnalysis";
import { isShapeColorCell, parseShapeCoordKey, toShapeCoordKey } from "@/lib/shapeModel";
import { getShadedRgb, MAP_SIZE } from "@/utils/color";
import { isSuppressStepsBuildMode } from "@/utils/conversion";
import type { ParsedColorGridTile } from "@/lib/colorGridParsing";

// Callers:
// - src/Index.tsx
// - src/lib/previewImageStore.ts
export interface PreviewPixelReplacement {
  x: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

// Callers:
// - src/Index.tsx
// - src/lib/previewImageStore.ts
export type PreviewPixelMask = Uint8Array;

const BLOCK_BASE_COLOR_INDEX = new Map(Object.keys(MINECRAFT_VERSIONS).map(key => {
  const version = key as MinecraftVersion;
  const catalog = getMinecraftCatalog(version);
  return [version, new Map(catalog.blocks.flatMap((blocks, id) =>
    [...blocks, ...catalog.excluded[id]].map(block => [block, id] as const),
  ))] as const;
}));

function getBlockLightShadeReplacement(block: string, version: MinecraftVersion): readonly [number, number, number] | null {
  const colors = BLOCK_BASE_COLOR_INDEX.get(version)!;
  const baseIndex = colors.get(toDisplayName(block)) ?? colors.get(normalizeBlockId(block));
  if (baseIndex === undefined || baseIndex === TRANSPARENCY_BASE_INDEX) return null;
  const { r, g, b } = BASE_COLORS[baseIndex];
  return [r, g, b];
}

type CollectVsFillerPreviewReplacementOptions = {
  minecraftVersion?: MinecraftVersion;
  shape: GeneratedShape | null;
  shadeFillerBlock: string;
  dominateVoidFillerBlock: string;
  recessiveVoidFillerBlock: string;
  xColumnRange?: [number, number];
  zColumnRange?: [number, number];
};

type StepPreviewOptions = {
  shape: GeneratedShape | null;
  phaseRange?: [number, number];
  retainedState?: ReturnType<typeof analyzeMaterialNeeds>["retainedState"];
  selections: ColorBlockSelections;
  fillerAssignments: FillerAssignment[];
  belowPlatformWater: boolean;
};

// Callers:
// - src/Index.tsx
export function collectVsFillerPreviewReplacements(
  {
    shape,
    shadeFillerBlock,
    dominateVoidFillerBlock,
    recessiveVoidFillerBlock,
    xColumnRange,
    zColumnRange,
    minecraftVersion = DEFAULT_MINECRAFT_VERSION,
  }: CollectVsFillerPreviewReplacementOptions,
): PreviewPixelReplacement[] {
  if (!shape) return [];

  const dominantBlock = dominateVoidFillerBlock || shadeFillerBlock;
  const recessiveBlock = recessiveVoidFillerBlock || shadeFillerBlock;
  const dominantRgb = isShadeFillerDisabled(dominantBlock) ? null : getBlockLightShadeReplacement(dominantBlock, minecraftVersion);
  const recessiveRgb = isShadeFillerDisabled(recessiveBlock) ? null : getBlockLightShadeReplacement(recessiveBlock, minecraftVersion);

  const roles = [
    ...(dominantRgb ? [FillerRole.ShadeVoidDominant] : []),
    ...(recessiveRgb ? [FillerRole.ShadeVoidRecessive] : []),
  ];
  if (roles.length === 0) return [];

  return collectFillerRolePixels(shape, roles, xColumnRange, zColumnRange).flatMap(({ x, z, role }) => {
    const rgb = role === FillerRole.ShadeVoidDominant ? dominantRgb : recessiveRgb;
    if (!rgb) return [];
    const [r, g, b] = rgb;
    return [{ x, z, r, g, b }];
  });
}

// Callers:
// - src/Index.tsx
export function offsetPreviewPixelReplacements(
  replacements: readonly PreviewPixelReplacement[],
  tile: ParsedColorGridTile,
): PreviewPixelReplacement[] {
  return replacements.map(replacement => ({
    ...replacement,
    x: replacement.x + tile.startX,
    z: replacement.z + tile.startZ,
  }));
}

// Callers:
// - src/Index.tsx
export function buildSelectedTileVisibleMask(
  imageData: ImageData,
  tile: ParsedColorGridTile,
  tileVisibleMask?: PreviewPixelMask | null,
  xColumnRange?: readonly [number, number],
  zColumnRange?: readonly [number, number],
): PreviewPixelMask | null {
  if (!tileVisibleMask && !xColumnRange && !zColumnRange) return null;
  const mask = new Uint8Array(imageData.width * imageData.height);
  mask.fill(1);

  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const visibleByRange = (!xColumnRange || (x >= xColumnRange[0] && x <= xColumnRange[1])) &&
        (!zColumnRange || (z >= zColumnRange[0] && z <= zColumnRange[1]));
      const globalX = tile.startX + x;
      const globalZ = tile.startZ + z;
      mask[globalZ * imageData.width + globalX] = visibleByRange ? (tileVisibleMask?.[z * MAP_SIZE + x] ?? 1) : 0;
    }
  }

  return mask;
}

function getBuildModeRangeMax(buildMode: BuildMode, centerOut = false): number {
  switch (buildMode) {
    case BuildMode.SuppressStepPairs:
      return centerOut ? 64 : 128;
    case BuildMode.SuppressStepChecker:
      return centerOut ? 32 : 64;
    default:
      return 127;
  }
}

// Callers:
// - src/Index.tsx
export function getPreviewRangeMax(
  buildMode: BuildMode,
  shape: GeneratedShape | null,
  centerOut: boolean,
  belowPlatformWater: boolean,
): number {
  if (!isSuppressStepsBuildMode(buildMode)) return getBuildModeRangeMax(buildMode);
  // Do not clamp the step range to a previous single-part shape while geometry updates.
  if (shape?.partType === ShapePartType.SuppressStepPhases) return Math.max(0, shape.parts.length - 1);
  return getBuildModeRangeMax(buildMode, centerOut) + Number(belowPlatformWater);
}

function getPreviewPixelParts(shape: GeneratedShape, phaseRange?: [number, number]) {
  if (shape.partType !== ShapePartType.SuppressStepPhases || !phaseRange) return shape.parts;
  const [start, end] = phaseRange;
  return shape.parts.slice(start, end + 1);
}

function collectRetainedPixelReplacements(
  { retainedState, selections, fillerAssignments, belowPlatformWater }: StepPreviewOptions,
): PreviewPixelReplacement[] {
  if (!retainedState) return [];
  const { blocks, pixelMask } = retainedState;
  const colors = BLOCK_BASE_COLOR_INDEX.get(selections.minecraftVersion ?? DEFAULT_MINECRAFT_VERSION)!;
  const assignments = buildFillerAssignmentMap(fillerAssignments);
  const fillerColors = new Map<string, ColorRef | null>();
  const colorAt = (coord: number): ColorRef | null => {
    const material = blocks.get(coord);
    if (!material) return null;
    if (material.colorKey !== undefined) return parseColorRefKey(material.colorKey);
    const assigned = material.role && assignments.get(material.role);
    // Special support overrides keep their actual block, not the requested filler.
    const name = assigned && normalizeBlockId(assigned) === material.blockName ? toDisplayName(assigned) : material.blockName;
    if (!fillerColors.has(name)) {
      const id = colors.get(name) ?? colors.get(normalizeBlockId(name));
      fillerColors.set(name, id === undefined ? null : { id, isCustom: false });
    }
    return fillerColors.get(name)!;
  };
  const columns = new Map<number, { y: number; color: ColorRef; waterShade?: Shade }>();
  for (const [coord, material] of blocks) {
    const color = colorAt(coord);
    if (!color || (!color.isCustom && color.id === TRANSPARENCY_BASE_INDEX)) continue;
    const [x, y, z] = parseShapeCoordKey(coord);
    if (x < 0 || x >= MAP_SIZE || z < -1 || z >= MAP_SIZE) continue;
    const key = (z + 1) * MAP_SIZE + x;
    if (y > (columns.get(key)?.y ?? -Infinity)) columns.set(key, {
      y, color,
      waterShade: belowPlatformWater && material.waterColumn !== undefined && material.visibleKey !== undefined
        ? material.visibleKey % 4 : undefined,
    });
  }
  const replacements: PreviewPixelReplacement[] = [];
  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      if (!pixelMask[z * MAP_SIZE + x]) continue;
      const column = columns.get((z + 1) * MAP_SIZE + x);
      if (!column) continue;
      const { y, color, waterShade } = column;
      const northY = columns.get(z * MAP_SIZE + x)?.y ?? -Infinity;
      let shade = y > northY ? Shade.Light : y < northY ? Shade.Dark : Shade.Flat;
      if (!color.isCustom && color.id === WATER_BASE_INDEX) {
        if (waterShade !== undefined) {
          // Lowered-water layers rely on the user's external depth-shading platform.
          shade = waterShade;
        } else {
          let depth = 1;
          for (;;) {
            const nextColor = colorAt(toShapeCoordKey(x, y - depth, z));
            if (!nextColor || nextColor.isCustom || nextColor.id !== WATER_BASE_INDEX) break;
            ++depth;
          }
          const waterShade = depth * 0.1 + ((x + z) & 1) * 0.2;
          shade = waterShade < 0.5 ? Shade.Light : waterShade > 0.9 ? Shade.Dark : Shade.Flat;
        }
      }
      const [r, g, b] = getShadedRgb({ ...color, shade }, selections.customColors);
      replacements.push({ x, z, r, g, b });
    }
  }
  return replacements;
}

function collectStepPreview(options: StepPreviewOptions): { mask: PreviewPixelMask | null; replacements: PreviewPixelReplacement[] } {
  const { shape, phaseRange } = options;
  if (!shape) return { mask: null, replacements: [] };
  const replacements = collectRetainedPixelReplacements(options);
  const mask = new Uint8Array(MAP_SIZE * MAP_SIZE);
  for (const { x, z } of replacements) mask[z * MAP_SIZE + x] = 1;

  for (const part of getPreviewPixelParts(shape, phaseRange)) {
    for (const [coord, cell] of part.cells) {
      if (!isShapeColorCell(cell)) continue;
      const [x, , z] = parseShapeCoordKey(coord);
      if (x < 0 || x >= MAP_SIZE || z < 0 || z >= MAP_SIZE) continue;
      mask[z * MAP_SIZE + x] = 1;
    }
  }

  return { mask, replacements };
}

// Callers:
// - src/Index.tsx
export function useVsFillerPreviewReplacements(
  options: CollectVsFillerPreviewReplacementOptions,
): PreviewPixelReplacement[] {
  return useMemo(
    () => collectVsFillerPreviewReplacements(options),
    [
      options.shape,
      options.minecraftVersion,
      options.shadeFillerBlock,
      options.dominateVoidFillerBlock,
      options.recessiveVoidFillerBlock,
      options.xColumnRange?.[0],
      options.xColumnRange?.[1],
      options.zColumnRange?.[0],
      options.zColumnRange?.[1],
    ],
  );
}

// Callers:
// - src/Index.tsx
export function useStepPreview(options: StepPreviewOptions) {
  return useMemo(
    () => collectStepPreview(options),
    [
      options.shape,
      options.phaseRange?.[0],
      options.phaseRange?.[1],
      options.retainedState,
      options.selections,
      options.fillerAssignments,
      options.belowPlatformWater,
    ],
  );
}
