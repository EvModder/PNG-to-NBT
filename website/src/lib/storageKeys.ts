/**
 * Public API:
 * - STORAGE_KEYS
 *
 * Callers:
 * - src/Index.tsx
 * - src/main.tsx
 * - src/data/presets.ts
 */
export const STORAGE_KEYS = {
  presets: "mapart_presets",
  theme: "mapart_theme",

  supportFiller: "mapart_support_filler",
  shadeFiller: "mapart_shade_filler",
  buildMode: "mapart_build_mode",
  supportMode: "mapart_support_mode",
  showStacks: "mapart_show_stacks",
  showIds: "mapart_show_ids",
  showNames: "mapart_show_names",
  showOptions: "mapart_show_options",
  blockDisplayMode: "mapart_block_display_mode",
  blockColExpanded: "mapart_block_column_expanded",
  activePreset: "mapart_active_preset",
  sortKey: "mapart_sort_key",
  sortDir: "mapart_sort_dir",
  layerGap: "mapart_layer_gap",
  mixSteps: "mapart_mix_steps",
  suppressStepDirection: "mapart_suppress_step_direction",
  suppress2LayerLateFiller: "mapart_suppress_2layer_late_filler",
  paletteSeed: "mapart_palette_seed",
  dominateVoidFiller: "mapart_dominate_void_filler",
  recessiveVoidFiller: "mapart_recessive_void_filler",
  showVsFillersInPreview: "mapart_show_vs_fillers_in_preview",
  columnOrder: "mapart_column_order",
  lightWaterDrop: "mapart_light_water_drop",
  flatWaterDrop: "mapart_flat_water_drop",
  darkWaterDrop: "mapart_dark_water_drop",
  showTransparentRow: "mapart_secret_show_transparent_row",
  showExcludedBlocks: "mapart_secret_show_excluded_blocks",
  forceZ129: "mapart_secret_force_z129",
  assumeFloor: "mapart_secret_assume_floor",
  belowPlatformWater: "mapart_secret_below_platform_water",
  showVsFillerWarnings: "mapart_secret_show_vs_filler_warnings",
  showAlignmentReminder: "mapart_secret_show_alignment_reminder",
  showNooblineWarnings: "mapart_secret_show_noobline_warnings",
} as const;
