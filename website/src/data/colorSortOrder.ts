/**
 * Public API:
 * - DEFAULT_COLOR_ROW_ORDER
 *
 * Used by:
 * - src/Index.tsx
 */
import { BASE_COLORS } from "./mapColors";

const WOOL_CREATIVE_ORDER = [8, 22, 21, 29, 26, 28, 15, 18, 19, 27, 23, 17, 25, 24, 16, 20];
const TERRACOTTA_CREATIVE_ORDER = [36, 44, 43, 51, 48, 50, 37, 40, 41, 49, 45, 39, 47, 46, 38, 42];

export const DEFAULT_COLOR_ROW_ORDER = (() => {
  const fixedSet = new Set([...WOOL_CREATIVE_ORDER, ...TERRACOTTA_CREATIVE_ORDER]);
  const others = Array.from({ length: BASE_COLORS.length - 1 }, (_, i) => i + 1)
    .filter(i => !fixedSet.has(i))
    .sort((a, b) => BASE_COLORS[b].blocks.length - BASE_COLORS[a].blocks.length);
  return [...WOOL_CREATIVE_ORDER, ...TERRACOTTA_CREATIVE_ORDER, ...others];
})();
