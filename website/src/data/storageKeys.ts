/**
 * Public API:
 * - STORAGE_KEYS
 *
 * Callers:
 * - src/Index.tsx
 * - src/main.tsx
 * - src/data/presets.ts
 */
// Callers:
// - src/Index.tsx
// - src/main.tsx
// - src/data/presets.ts
export const STORAGE_KEYS = {
  presets: "mapart_presets",
  theme: "mapart_theme",

  supportFiller: "mapart_support_filler",
  shadeFiller: "mapart_shade_filler",
  buildMode: "mapart_build_mode",
  supportMode: "mapart_support_mode",
  showStacks: "mapart_show_stacks",
  maxPerSplit: "mapart_max_per_split",
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
  buildAtWorldMinY: "mapart_build_at_world_min_y",
  suppressStepDirection: "mapart_suppress_step_direction",
  vsFillerLoadSpotDirection: "mapart_vs_filler_load_spot_direction",
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
  forceXZ128: "mapart_secret_force_xz128",
  forceZ129: "mapart_secret_force_z129",
  applySupportFloorYs: "mapart_secret_apply_support_floor_ys",
  belowPlatformWater: "mapart_secret_below_platform_water",
  skipEmptySuppressSteps: "mapart_secret_skip_empty_suppress_steps",
  showFlatNbtSuppressStepModes: "mapart_secret_show_flat_nbt_suppress_step_modes",
  markSuppressLoadSpotsInSchematic: "mapart_secret_mark_suppress_load_spots_in_schematic",
  suppressLoadSpotMarkerBlock: "mapart_secret_suppress_load_spot_marker_block",
  showVsFillerWarnings: "mapart_secret_show_vs_filler_warnings",
  showAlignmentReminder: "mapart_secret_show_alignment_reminder",
  showNooblineWarnings: "mapart_secret_show_noobline_warnings",
} as const;
