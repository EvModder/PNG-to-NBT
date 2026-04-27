/**
 * Public API:
 * - DEFAULT_*
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/ToolbarFillerSettings.tsx
 * - src/lib/suppressLoadMarkers.ts
 * - tests/run.mts
 */
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { type BlockDisplayMode, type ColumnId, type SortDir, type SortKey, SupportMode } from "@/types/ui";

// Callers:
// - src/Index.tsx
// - src/components/ToolbarFillerSettings.tsx
// - tests/run.mts
export const DEFAULT_ACTIVE_PRESET_NAME = "Fullblock";
export const DEFAULT_SUPPORT_FILLER_BLOCK = "cobblestone";
export const DEFAULT_SHADE_FILLER_BLOCK = "resin_block";
export const DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK = "slime_block";
export const DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK = "slime_block";
export const DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK = "honey_block";

// Callers:
// - src/Index.tsx
// - src/components/SecretsSettingsDialog.tsx
// - src/lib/suppressLoadMarkers.ts
export const SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS = ["jigsaw", "barrier"] as const;
export type SuppressLoadSpotMarkerBlock = typeof SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS[number];
export const DEFAULT_SUPPRESS_LOAD_SPOT_MARKER_BLOCK: SuppressLoadSpotMarkerBlock = "jigsaw";

// Callers:
// - src/Index.tsx
// - tests/run.mts
export const DEFAULT_BUILD_MODE = BuildMode.StaircaseGroup;
export const DEFAULT_SUPPORT_MODE = SupportMode.None;
export const DEFAULT_SUPPRESS_STEP_DIRECTION = SuppressStepDirection.EastToWest;
export const DEFAULT_PALETTE_SEED = false;
export const DEFAULT_LAYER_GAP = 5;
export const DEFAULT_MIX_STEPS = false;
export const DEFAULT_LIGHT_WATER_DROP = 0;
export const DEFAULT_FLAT_WATER_DROP = 2;
export const DEFAULT_DARK_WATER_DROP = 4;
export const DEFAULT_BUILD_AT_WORLD_MIN_Y = true;

// Callers:
// - src/Index.tsx
export const DEFAULT_SHOW_VS_FILLERS_IN_PREVIEW = false;
export const DEFAULT_SHOW_NAMES = false;
export const DEFAULT_SHOW_IDS = false;
export const DEFAULT_SHOW_OPTIONS = false;
export const DEFAULT_BLOCK_DISPLAY_MODE: BlockDisplayMode = "textures";
export const DEFAULT_BLOCK_COLUMN_EXPANDED = true;
export const DEFAULT_SORT_KEY: SortKey = "default";
export const DEFAULT_SORT_DIR: SortDir = "asc";
export const DEFAULT_MC_UNITS = true;
export const DEFAULT_MAX_PER_SPLIT = true;
export const DEFAULT_COLUMN_ORDER: ColumnId[] = ["clr", "id", "name", "block", "options", "required"];
export const DEFAULT_SHOW_TRANSPARENT_ROW = false;
export const DEFAULT_SHOW_EXCLUDED_BLOCKS = false;
export const DEFAULT_FORCE_XZ128 = true;
export const DEFAULT_FORCE_Z129 = false;
export const DEFAULT_APPLY_SUPPORT_FLOOR_YS = true;
export const DEFAULT_BELOW_PLATFORM_WATER = false;
export const DEFAULT_SKIP_EMPTY_SUPPRESS_STEPS = true;
export const DEFAULT_SHOW_FLAT_NBT_SUPPRESS_STEP_MODES = false;
export const DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC = false;
export const DEFAULT_SHOW_VS_FILLER_WARNINGS = true;
export const DEFAULT_SHOW_ALIGNMENT_REMINDER = true;
export const DEFAULT_SHOW_NOOBLINE_WARNINGS = true;

// Callers:
// - src/Index.tsx
// - tests/run.mts
export const DEFAULT_CONVERT_UNSUPPORTED_COLORS = true;
export const DEFAULT_CROP_IMAGE = true;
export const DEFAULT_SWITCH_TO_SUPPRESS_CHECKER_IF_CONTAINS_VOID_SHADOWS = false;
