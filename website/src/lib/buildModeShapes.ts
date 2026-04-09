/**
 * Public API:
 * - getShapeForBuildMode()
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/tileGeometry.worker.ts
 */
import type { GeneratedShape } from "@/types/shape";
import { BuildMode } from "@/types/conversion";
import { isStaircaseBuildMode } from "@/utils/conversion";

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
// - src/lib/tileGeometry.worker.ts
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
