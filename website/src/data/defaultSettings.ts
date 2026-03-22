/**
 * Public API:
 * - DEFAULT_*
 *
 * Callers:
 * - src/Index.tsx
 * - tests/run.mts
 */
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/types/ui";

// Callers:
// - src/Index.tsx
// - tests/run.mts
export const DEFAULT_ACTIVE_PRESET_NAME = "Fullblock";
export const DEFAULT_SUPPORT_FILLER_BLOCK = "cobblestone";
export const DEFAULT_SHADE_FILLER_BLOCK = "resin_block";
export const DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK = "slime_block";
export const DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK = "slime_block";
export const DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK = "honey_block";

export const DEFAULT_BUILD_MODE = BuildMode.StaircaseGrouped;
export const DEFAULT_SUPPORT_MODE = SupportMode.None;
export const DEFAULT_SUPPRESS_STEP_DIRECTION = SuppressStepDirection.EastToWest;
export const DEFAULT_PALETTE_SEED = false;
export const DEFAULT_LAYER_GAP = 5;
export const DEFAULT_MIX_STEPS = false;
export const DEFAULT_LIGHT_WATER_DROP = 0;
export const DEFAULT_FLAT_WATER_DROP = 2;
export const DEFAULT_DARK_WATER_DROP = 4;

export const DEFAULT_SHOW_VS_FILLERS_IN_PREVIEW = false;
export const DEFAULT_SHOW_NAMES = false;
export const DEFAULT_SHOW_IDS = false;
export const DEFAULT_SHOW_OPTIONS = false;
export const DEFAULT_BLOCK_DISPLAY_MODE: BlockDisplayMode = "textures";
export const DEFAULT_BLOCK_COLUMN_EXPANDED = true;
export const DEFAULT_SORT_KEY = "default";
export const DEFAULT_SORT_DIR = "asc";
export const DEFAULT_MC_UNITS = false;
export const DEFAULT_COLUMN_ORDER: ColumnId[] = ["clr", "id", "name", "block", "options", "required"];
export const DEFAULT_SHOW_TRANSPARENT_ROW = false;
export const DEFAULT_SHOW_EXCLUDED_BLOCKS = false;
export const DEFAULT_FORCE_Z129 = false;
export const DEFAULT_APPLY_SUPPORT_FLOOR_YS = true;
export const DEFAULT_BELOW_PLATFORM_WATER = false;
export const DEFAULT_SHOW_VS_FILLER_WARNINGS = true;
export const DEFAULT_SHOW_ALIGNMENT_REMINDER = true;
export const DEFAULT_SHOW_NOOBLINE_WARNINGS = false;

export const DEFAULT_CONVERT_UNSUPPORTED = true;
export const AUTO_SWITCH_TO_SUPPRESS_STEPS_IF_CONTAINS_VOID_SHADOWS = true;
