/**
 * Public API:
 * - enCatalog
 * - MessageCatalog
 *
 * Callers:
 * - src/data/i18n/*
 * - src/lib/messages.ts
 */
import { Shade } from "@/types/color";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { SupportMode, type BlockDisplayMode, type ColumnId } from "@/types/ui";

type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

type WidenStrings<T> =
  T extends string ? string
  : T extends readonly (infer U)[] ? readonly WidenStrings<U>[]
  : T extends object ? { [K in keyof T]: WidenStrings<T[K]> }
  : T;

// Callers:
// - src/lib/messages.ts
export const enCatalog = {
  locale: "en",
  common: {
    none: "(none)",
    requiredBadge: "R:",
    add: "Add",
    remove: "Remove",
    close: "Close",
    copied: "Copied!",
    clearSelectionSymbol: "∅",
    missingTextureSymbol: "?",
    openSecretsSettings: "Open secret settings",
    toggleThemeAriaLabel: "Toggle theme",
    languageAriaLabel: "Language",
    languageBrowserOption: "Browser",
    unsavedChanges: "Unsaved changes",
    newPresetTitle: "Name new preset from current settings",
  },
  app: {
    title: "Image → Schematic",
  },
  blocks: {
    iceWaterTooltip:
      "Ice can be built in place of water or waterlogged blocks, but must be converted to water in-game to get the correct map colors.",
    iceWaterOptionTitle: "{blockId} - {tooltip}",
  },
  presets: {
    label: "Preset:",
    builtInGroupLabel: "Built-in",
    customGroupLabel: "Custom",
    copiedUrlAlert: "URL copied to clipboard!",
    invalidUrlAlert: "Could not load the shared preset. The link is invalid or incompatible. Your settings have not changed.",
    namePrompt: "Enter preset name:",
    fallbackTitle: "Edit preference",
    fallbackSelected: "New:",
    fallbackPrevious: "Old:",
    fallbackQuestion: "Apply:",
    fallbackKeep: "MC {operator} {version}",
    fallbackReplace: "Everywhere",
    saveTitle: "Save current preset edits",
    shareTitle: "Copy URL to clipboard",
    deleteTitle: "Delete current preset",
    builtinTooltips: {
      Fullblock: "Fast-to-mine, high visual contrast (easily distinguishable) full blocks.",
      Carpets: "Just carpets, cheapest and easiest.",
      PistonClear: "Piston-clearables for use with a non-TNT/nuker auto-resetting platform.",
      CrubTech: "Block choices intended for the CrubTech 2-layer suppress platform.",
    },
  },
  supportMode: {
    label: "Support:",
    optionLabels: {
      [SupportMode.None]: "None",
      [SupportMode.Steps]: "Steps",
      [SupportMode.All]: "All",
      [SupportMode.Fragile]: "Fragile",
      [SupportMode.Water]: "Water",
    } as const satisfies Record<SupportMode, string>,
    tooltips: {
      [SupportMode.None]: "No support blocks (shading only)",
      [SupportMode.Steps]: "Adds support blocks below raised blocks.",
      [SupportMode.All]: "Adds support blocks below every block.",
      [SupportMode.Fragile]: "Adds support blocks below fragile blocks.",
      [SupportMode.Water]: "Adds support blocks around water, or below ice pillars (if used instead of water).",
    } as const satisfies Record<SupportMode, string>,
    selectedFallbackTooltip: "Selected support mode.",
  },
  buildMode: {
    label: "Shading:",
    staircaseGroupLabel: "Staircase",
    suppressGroupLabel: "Suppress",
    crubTechLabel: "CrubTech:",
    crubTechTooltip:
      "For 2-layer suppress builds, split upper shading fillers into breakable and pushable variants so east-west adjacent shade fillers do not all use the same CrubTech behavior.",
    latePairsGapLabel: "Late-pairs gap:",
    latePairsGapTooltip: "Vertical gap above the normal upper 2-layer block used for late-pair placements added during each suppress update phase.",
    layerGapLabel: "Layer gap:",
    layerGapTooltip: "Layer gap controls the vertical spacing between lower and upper 2-layer suppress sections.",
    mixStepsLabel: "Printer+Nuker:",
    mixStepsTooltip:
      "Keep reusable blocks between phases to provide shading, reducing placement and manual mining. Disable for platforms with built-in clearing.",
    keepSuppressExtrasLabel: "Full recycling",
    keepSuppressExtrasTooltip: "On: Full recycling. Clear all obsolete blocks each step.\nOff: Partial recycling. Leave extra blocks for later platform clearing or reuse in another mapart. Barriers mark spaces that MUST be cleared each step: remove Litematica verifier-marked Wrong blocks, and ignore Extras. Requires more materials because fewer blocks are recycled between steps.",
    centerOutLabel: "Center-out:",
    centerOutTooltip: "Build in one direction; load from one side.\nOr build outward from the center; load from both sides.",
    centerOutEastWest: "W←Center→E",
    centerOutNorthSouth: "N←Center→S",
    buildAtWorldMinYLabel: "Build at Y=0:",
    buildAtWorldMinYTooltip:
      "Flat-map optimization: build the map at world minimum Y so flat-shade pixels directly south of transparent pixels do not require color suppression fillers.",
    waterShadeNames: {
      [Shade.Dark]: "dark",
      [Shade.Flat]: "medium",
      [Shade.Light]: "light",
    } as const,
    waterLevelTooltip:
      "{shadeName} water shade: 0 places this shade's water block at the non-water floor Y. Each increment lowers it by 1 block. Used water shades must have distinct values.",
    waterLevelAriaLabel: "{shadeName} water shade level",
    paletteSeedLabel: "Palette seed:",
    stepDirectionLabels: {
      [SuppressStepDirection.EastToWest]: "E→W",
      [SuppressStepDirection.WestToEast]: "W→E",
      [SuppressStepDirection.NorthToSouth]: "N→S",
      [SuppressStepDirection.SouthToNorth]: "S→N",
    } as const satisfies Record<SuppressStepDirection, string>,
    stepDirectionTooltip: "Suppression direction: {directionLabel}. Click to cycle.",
    twoLayerClearScope: { oneWay: "per step", centerOut: "per side" },
    twoLayerDirectionTooltip: "Load the full map first. Clear two upper-layer columns {clearScope}, then add late blocks only in the cleared area. Load 126 blocks beyond the last cleared column. Initial load lines inside the build are unmarked.",
    twoLayerNorthSouthTooltip: "Load the full map first. Clear one upper-layer row {clearScope}, then add late blocks only in the cleared area. Load 127 blocks south of the last cleared row for N→S, or 126 north for S→N. Clear the upper north border with row 0. Initial load lines inside the build are unmarked.",
    stepDirectionAriaLabel: "Suppression direction {directionLabel}",
    optionLabels: {
      [BuildMode.Flat]: "Flat",
      [BuildMode.InclineUp]: "Incline (Up)",
      [BuildMode.InclineDown]: "Incline (Down)",
      [BuildMode.StaircaseNorthline]: "Staircase (Northline)",
      [BuildMode.StaircaseSouthline]: "Staircase (Southline)",
      [BuildMode.StaircaseClassic]: "Staircase (Classic)",
      [BuildMode.StaircaseValley]: "Staircase (Valley)",
      [BuildMode.StaircaseGroup]: "Staircase (Group)",
      [BuildMode.StaircaseParty]: "Staircase (Party)",
      [BuildMode.SuppressSplitRow]: "Suppress (Split: Rows)",
      [BuildMode.SuppressSplitChecker]: "Suppress (Split: Checker)",
      [BuildMode.SuppressStepPairs]: "Suppress (Steps: Pairs)",
      [BuildMode.SuppressStepChecker]: "Suppress (Steps: Checker)",
      [BuildMode.Suppress2Layer]: "Suppress (2-Layer)",
      [BuildMode.Suppress2LayerLateFillers]: "Suppress (2-Layer, Late-Fillers)",
      [BuildMode.Suppress2LayerLatePairs]: "Suppress (2-Layer, Late-Pairs)",
    } as const satisfies Record<BuildMode, string>,
    tooltips: {
      [BuildMode.Flat]: "Flat: all color blocks in the generated shape are at the same Y-level.",
      [BuildMode.InclineUp]:
        "All non-transparent non-water pixels slope upward uniformly, so all staircase methods collapse to this incline-up alias (same backend output as northline).",
      [BuildMode.InclineDown]:
        "All non-transparent non-water pixels slope downward uniformly, so all staircase methods collapse to this incline-down alias (same backend output as northline).",
      [BuildMode.StaircaseNorthline]: "Aligns each column N→S from a reference (noob)line of blocks",
      [BuildMode.StaircaseSouthline]: "Aligns each column S→N from a reference line of blocks (the bottom row)",
      [BuildMode.StaircaseClassic]: "Minimizes maxY-minY diff, while keeping N→S columns contiguous",
      [BuildMode.StaircaseValley]:
        "Minimizes maxY-minY diff, and splits up N→S columns, lowering each segment as much as possible",
      [BuildMode.StaircaseGroup]: "Valley-style segmentation with safe cross-column grouping to reduce isolated low runs",
      [BuildMode.StaircaseParty]: "Same MapArt, but makes the build process more fun and exciting!",
      [BuildMode.SuppressSplitRow]: "Split-row; available for compatibility, but generally not useful",
      [BuildMode.SuppressSplitChecker]: "Split NBT generations for dominant/recessive placements",
      [BuildMode.SuppressStepPairs]:
        "Stepwise suppress in interlaced pairs. The current direction is selected separately. Each step updates one farther dominant pixel and one nearer recessive pixel from adjacent lines, then the next step is rebuilt farther away so the dominant pixel can be remapped without remapping the recessive one.",
      [BuildMode.SuppressStepChecker]:
        "Like Suppress (2-Layer), but encoded as vertically separated phases instead of upper/lower layers. The current direction is selected separately. Each step handles 4 lines: 2 farther dominant lines and 2 nearer recessive lines.",
      [BuildMode.Suppress2Layer]:
        "Steps:\n1) Build everything\n2) Update the full map\n3) Remove the upper layer, 1-2 columns at a time\n4) Carefully update *just* the dominate pixels for the target column(s)\n5) Repeat, column-by-column, for the entire map\n\nLayer gap controls vertical spacing between lower and upper suppress layers.",
      [BuildMode.Suppress2LayerLateFillers]:
        "Suppress-phase placements use a custom 'late filler' block (on the lower layer), and should be skipped during initial build-phase.\n\nSteps:\n1) Build all 'non-late' blocks\n2) Update the full map\n3) Remove the upper layer, 1-2 columns at a time\n4) For each removed column, add in any late-blocks\n5) Carefully update *just* the dominate pixels for the target column(s)\n6) Repeat for the whole map\n\nLayer gap controls vertical spacing between lower and upper suppress layers.",
      [BuildMode.Suppress2LayerLatePairs]:
        "Suppress-phase placements use a custom 'late filler' block (at the highest Y-layer), and should be skipped during initial build-phase.\n\nSteps:\n1) Build all 'non-late' blocks\n2) Update the full map\n3) Remove the upper layer, 1-2 columns at a time\n4) For each removed column, add in any late-blocks\n5) Carefully update *just* the dominate pixels for the target column(s)\n6) Repeat for the whole map\n\nLayer gap controls vertical spacing between lower and upper suppress layers.",
    } as const satisfies Record<BuildMode, string>,
    selectedFallbackTooltip: "Selected shading method.",
  },
  fillers: {
    heading: "Fillers",
    floorAttachmentWarning: "Only attachment from below is supported.",
    supportRequiresSupportWarning: "Needs support itself.",
    fixFloorAttachment: "Use down=true",
    headingTooltip: "Filler block assignments for support, shading, and special-case placements.",
    supportLabel: "Support:",
    supportTooltip:
      "Used for support and convenience filler placements, including Steps, All, Fragile, Water support, and water-path connectors.",
    supportRequiredTooltip: "Required support/convenience filler placements for the current output range.",
    shadeLabel: "Shade:",
    nooblineLabel: "Noobline:",
    shadeTooltip: "Used for north-row and suppress shading filler placements.",
    nooblineTooltip: "Used for north-row shading filler placements.",
    shadeRequiredTooltip: "Required north-row and suppress-shading filler placements for the current output range.",
    nooblineRequiredTooltip: "Required north-row shading filler placements for the current output range.",
    crubTechBreakableLabel: "Shade-Breakable:",
    crubTechSupportBreakableLabel: "Support/Shade-Breakable:",
    crubTechBreakableTooltip:
      "Used for CrubTech 2-layer shade and support placements that should break when pushed by piston/slime.",
    crubTechBreakableRequiredTooltip:
      "Required CrubTech breakable shade and support filler placements for the current output range.",
    crubTechPushableLabel: "Shade-Pushable:",
    crubTechSupportPushableLabel: "Support/Shade-Pushable:",
    crubTechPushableTooltip:
      "Used for CrubTech 2-layer shade and support placements that must remain pushable by piston/slime.",
    crubTechPushableRequiredTooltip:
      "Required CrubTech pushable shade and support filler placements for the current output range.",
    dominateVoidLabel: "VS-1:",
    dominateVoidWarningLabel: "VS-Filler-1",
    dominateVoidTooltip:
      "When a dominant pixel needs flat/dark shading, but the pixel north is transparent.\n\nInclude this filler in the initial build/load.\nWhen updating: remove it, then ONLY reload the north (transparent) pixel.",
    dominateVoidRequiredTooltip: "Required VS-Filler-1 placements for the current output range.",
    recessiveVoidLabel: "VS-2:",
    recessiveVoidWarningLabel: "VS-Filler-2",
    recessiveVoidTooltip:
      "When a recessive pixel needs flat/dark shading, but the pixel north is transparent.\n\nSkip this filler in the initial build/load.\nWhen updating: place it, then ONLY reload the south (color) pixel.",
    recessiveVoidRequiredTooltip: "Required VS-Filler-2 placements for the current output range.",
    voidFillersWarningLabel: "VS-Fillers",
    lateLabel: "Late:",
    lateTooltip: "Used by Suppress (2-Layer, Late-Fillers) for late lower-layer suppress placements.",
    lateRequiredTooltip: "Required late suppress filler placements for the current output range.",
  },
  table: {
    title: "Color → Block",
    titleTooltip: "Select which block to use for each color.",
    toggleIds: "IDs",
    toggleNames: "Names",
    toggleOptions: "#Options",
    toggleBlockDisplayTitle: "Toggle block display mode",
    blockDisplayLabels: {
      names: "names",
      textures: "textures",
    } as const satisfies Record<BlockDisplayMode, string>,
    mcUnitsLabel: "MC units:",
    mcUnitsTooltip: "Show material counts in terms of shulker boxes and item stacks.",
    maxPerSplitLabel: "Max per split:",
    maxPerSplitTooltip: "Show the maximum required count for each block across all 128×128 splits, instead of the sum.",
    columnLabels: {
      clr: "Clr",
      id: "ID",
      name: "Name",
      block: "Block",
      options: "Options",
      required: "Required",
    } as const satisfies Record<ColumnId, string>,
    columnSortTitles: {
      clr: "Sort by color hue",
      id: "Sort by color ID",
      name: "Sort by color name",
      block: "Assigned block used for this color",
      options: "Sort by number of available block options",
      required: "Sort by required block count in the current output",
    } as const satisfies Record<ColumnId, string>,
    blockColumnResizeExpanded: "Collapse block column to minimum width",
    blockColumnResizeCollapsed: "Expand block column to fill available width",
    blockColumnAriaExpanded: "Collapse block column",
    blockColumnAriaCollapsed: "Expand block column",
    unusedColorsLabel: {
      one: "{count} unused color (not in image)",
      other: "{count} unused colors (not in image)",
    } as PluralForms,
  },
  customColors: {
    title: "Custom Mappings",
    tooltip:
      "Add custom Color → Block mappings for RGB values that are not part of the standard palette.\nCustom RGB is interpreted as the base/light shade for the color ID.\nDark and flat shades are derived automatically using standard multipliers.\nOnce added, all three new shades will be available to use for input images.",
    ariaLabel: "Custom color shading info",
    customRgbOption: "Custom RGB",
    blockLabel: "Block",
    blockPlaceholder: "e.g. fart_block",
    usedInImage: {
      one: "{count} custom RGB color is used in this image.",
      other: "{count} custom RGB colors are used in this image.",
    } as PluralForms,
    unusedLabel: {
      one: "{count} unused custom color (not in image)",
      other: "{count} unused custom colors (not in image)",
    } as PluralForms,
  },
  upload: {
    title: "Image Preview",
    placeholder: "Click or drop a 128×128 image",
    showVsFillersToggle: "Show VS-Fillers:",
    showVsFillersTooltip: "Overlay non-transparent VS-Filler spots on the image preview.",
    copyImageUrlTitle: "Copy shareable image URL",
    copiedImageUrlAlert: "Image URL copied to clipboard!",
    sharedImageName: "shared-image.png",
    removeButton: "Remove",
    cancelButton: "Cancel",
    parsing: "Parsing image...",
    parsingProgress: "Parsing image {completed}/{total}...",
    analyzing: "Generating shapes...",
    analyzingProgress: "Generating shapes {completed}/{total}...",
    fillerAnalysis: "Computing filler requirements...",
    fillerAnalysisProgress: "Computing filler requirements {completed}/{total}...",
    materialAnalysis: "Computing required materials...",
    materialAnalysisProgress: "Computing required materials {completed}/{total}...",
    convertButtonConverting: "Converting...",
    convertButtonNbt: "Generate .nbt",
    convertButtonZip: "Generate .zip",
    convertButtonZipCount: "Generate .zip ({count} ids)",
    convertButtonLayerSplit: "Layer-split ({count})",
    convertButtonLayerSplitZip: "Layer-split .zip ({count})",
    convertButtonLayerSplitTitle: "Download separate schematics for each build layer.",
  },
  preview: {
    missingBlockAssignments: {
      one: "{count} input color has no preset-assigned block.",
      other: "{count} input colors have no preset-assigned block.",
    } as PluralForms,
    northRowAlignmentInfo:
      "Note: Align 128x128 color area to the map grid.\nExpect 1 extra top north row (NBT is 128x129).",
    iceConversionInfo:
      "Note: Ice has been selected for water-color.\nConvert it to water in-game for colors to be accurate.",
    eyeblossomWarning: "Overworld: eyeblossom colors cycle day/night.",
    noFillerNorthRowLine: "North-row shading requires filler placements.",
    noFillerSuppressLine: "Suppress-shading requires filler placements.",
    noFillerInGridLine: "Some shading-critical fillers are required inside the 128x128 grid.",
    noFillerWarning: "Shade-Filler is disabled ({value}).\n{lines}",
    crubTechBreakableInvalid: {
      one: "Shade/Support-Breakable is invalid ({value}).\n{count} CrubTech placement requires it.",
      other: "Shade/Support-Breakable is invalid ({value}).\n{count} CrubTech placements require it.",
    } as PluralForms,
    crubTechPushableInvalid: {
      one: "Shade/Support-Pushable is invalid ({value}).\n{count} CrubTech placement requires it.",
      other: "Shade/Support-Pushable is invalid ({value}).\n{count} CrubTech placements require it.",
    } as PluralForms,
    crubTechBreakableBehaviorWarning: {
      one: "Shade/Support-Breakable should break when pushed by piston/slime ({value}).\n{count} CrubTech placement uses it.",
      other: "Shade/Support-Breakable should break when pushed by piston/slime ({value}).\n{count} CrubTech placements use it.",
    } as PluralForms,
    crubTechPushableBehaviorWarning: {
      one: "Shade/Support-Pushable should remain pushable by piston/slime ({value}).\n{count} CrubTech placement uses it.",
      other: "Shade/Support-Pushable should remain pushable by piston/slime ({value}).\n{count} CrubTech placements use it.",
    } as PluralForms,
    waterSideSupportInvalid:
      "Support filler is invalid ({value}).\nSome water-side supports require a color_id=0 block, so those placements will not be counted or exported.",
    waterSideSupportNotColorIdZero:
      "Support filler is not color_id=0 ({value}).\nSome water-side supports require a color_id=0 block, so those placements will not be counted or exported.",
    fragileSupportOverrideWarningSingle:
      "Support for {blockId} must be {support}",
    fragileSupportOverrideWarning:
      "Support for {blockId} must be one of:\n{supports}",
    vsFillerInvalid: {
      one: "{label} is invalid ({value}).\n{count} pixel will be incorrectly light-shaded.",
      other: "{label} is invalid ({value}).\n{count} pixels will be incorrectly light-shaded.",
    } as PluralForms,
    vsFillerRequiredSingularLabel: {
      one: "{label} is required for this image.\n{count} spot will need manual color-suppression.",
      other: "{label} is required for this image.\n{count} spots will need manual color-suppression.",
    } as PluralForms,
    vsFillerRequiredPluralLabel: {
      one: "{label} are required for this image.\n{count} spot will need manual color-suppression.",
      other: "{label} are required for this image.\n{count} spots will need manual color-suppression.",
    } as PluralForms,
    vsFillersInvalid: {
      one: "VS-Fillers are invalid ({first}, {second}).\n{count} pixel will be incorrectly light-shaded.",
      other: "VS-Fillers are invalid ({first}, {second}).\n{count} pixels will be incorrectly light-shaded.",
    } as PluralForms,
    lateFillerInvalid: {
      one: "Late-Filler is invalid ({value}).\n{count} late suppress spot requires shading.",
      other: "Late-Filler is invalid ({value}).\n{count} late suppress spots require shading.",
    } as PluralForms,
    suppressStepNorthSouthWarning:
      "{modeLabel} {directionLabel} places north/south blocks in the same phase.\nTo preserve shading, this raises some color blocks, increasing build complexity.",
    suppressTwoLayerNorthSouthWarning: {
      oneWay: "2-Layer {directionLabel} clears one row per step.\nThis requires twice as many steps as E/W.",
      centerOut: "2-Layer {directionLabel} clears one row per side.\nThis requires twice as many steps as E/W.",
    },
    uniqueColorCount: {
      one: "{count} unique color",
      other: "{count} unique colors",
    } as PluralForms,
    blockTypeCount: {
      one: "{count} block type",
      other: "{count} block types",
    } as PluralForms,
    voidShadowCount: {
      one: "{count} VS-filler spot",
      other: "{count} VS-filler spots",
    } as PluralForms,
    stepRangeButton: "Step range",
    columnRangeButton: "Column range",
    rowRangeButton: "Row range",
    westEastSlopeButton: "W→E slope",
    westEastSlopeTooltip: "Slope generated map blocks west-to-east across columns before export.",
    westEastSlopeRunTitle: "West-to-east run, 0-127; 0 means every column",
    westEastSlopeRiseTitle: "Y change per W→E run; negative reverses the slope",
  },
  swatches: {
    transparent: "Transparent",
    shadeTooltip: "{shadeId}: {hex} | Click to copy",
  },
  dialogs: {
    secretSettingsTitle: "Secret Settings",
    options: {
      showTransparentRow: "Show color_id=0 row",
      showTransparentRowTooltip: "Show block choices for transparent map pixels.",
      showExcludedBlocks: "Show excluded blocks",
      showExcludedBlocksTooltip: "Show normally hidden block options.",
      collapseDuplicateNbtPaletteStates: "Collapse duplicate NBT palette states",
      collapseDuplicateNbtPaletteStatesTooltip: "In exports, share identical block entries across export roles. Disable to keep color, filler and support entries separate.",
      forceXZ128: "XZ-width always 128",
      forceXZ128Tooltip: "Preserve the full 128×128 map footprint in exports, even when edge pixels are empty.",
      forceZ129: "Z-width always 129",
      forceZ129Tooltip: "Always include space for the extra north shading row, even when unused.",
      assumeFloor: "Assume floor",
      assumeFloorTooltip: "Treat build platforms as already present; omit support blocks at the floor level.",
      belowPlatformWater: "Below-platform water",
      belowPlatformWaterTooltip: "Assume water placements below the platform, with adjustable surface heights for each shade.",
      skipEmptySuppressSteps: "Skip empty Suppress-steps",
      skipEmptySuppressStepsTooltip: "Omit empty steps and their vertical spacing from exports.",
      skipEmptySuppressStepsDisabledTooltip: "Full recycling is off. Empty steps may still need barriers to clear leftover blocks, including those from previous maps.",
      minSuppressStepOffset: "Min. Y-offset:",
      minSuppressStepOffsetTooltip: "Minimum vertical distance between successive Suppress-steps.",
      uniformSuppressStepSpacing: "Uniform Suppress-step spacing",
      uniformSuppressStepSpacingTooltip: "Disable to calculate spacing separately for each step. Enable to use the largest overall Y-offset for all steps.",
      showAlignmentReminder: "Show alignment reminder",
      showAlignmentReminderTooltip: "Reminder to align the color area, not the noobline, within the map grid.",
      showNooblineWarnings: "Show warnings for nooblines",
      showNooblineWarningsTooltip: "Shown any time a noobline is needed.",
      showVsFillerWarnings: "Show warnings for VS-Fillers in Staircase maps",
      showVsFillerWarningsTooltip: "Shown when temporary fillers are needed for shading south of transparent pixels.",
      showFlatNbtSuppressStepModes: "Show Suppress-step options for Flat maps",
      mixedStepReachableTop: "Jumpable Suppress-step tops",
      mixedStepReachableTopTooltip: "Keep raised blocks reachable with one jump. Requires lift 1, Fragile support and Assume floor.",
      maxStepColorBlockLift: "Max. lift ({printerNuker}):",
      maxStepColorBlockLiftTooltip: "Requires Printer+Nuker. Raise blocks to improve reuse between E/W Suppress-steps, reducing placement and mining. 0 keeps color blocks on the floor; shading fillers may reach +1. Higher values cap both above the floor.",
      markSuppressLoadSpotsInSchematic: "Mark Suppress-step load-spots in exports",
      markSuppressLoadSpotsInSchematicTooltip: "Add the selected marker block at positions where the player should load the map during suppression.",
      suppressLoadSpotMarkerBlock: "Marker block",
      autoScalePixelArt: "Auto-scale pixel art",
      autoScalePixelArtTooltip: "Automatically resize pixel art dimensions (where possible) to multiples of 128.",
      pixelArtScaleMode: "Scaling direction",
      pixelArtScaleModes: { upscale: "Upscale", downscale: "Downscale", both: "Both" },
      autoFixInvalidDimensions: "Auto-fix invalid input dimensions",
      autoFixInvalidDimensionsTooltip: "Automatically crop/pad images whose dimensions are not multiples of 128.",
      invalidDimensionsStrategy: "Fix method",
      invalidDimensionsStrategies: { crop: "Crop image", pad: "Pad image" },
      autoFixInvalidColors: "Auto-fix invalid input colors",
      autoFixInvalidColorsTooltip: "Automatically replace unsupported image colors with nearest matches.",
      invalidColorsPalette: "Color palette",
      invalidColorsPalettes: { full: "Fullcolor", current: "Preset-3D", "current-flat": "Preset-2D" },
      minecraftVersion: "Minecraft version:",
      minecraftVersionTooltip: "Affects block availability, block states, and export format.",
    },
  },
  credits: {
    title: "Credits",
    evModderName: "ÉvModder",
    evModderUrl: "https://www.youtube.com/@evmodder",
    evModderRole: "Creator of PNG-to-NBT &",
    mapToolsName: "MapTools",
    mapToolsUrl: "https://evmodder.net/EvMod/",
    crubleighName: "crubleigh",
    crubleighUrl: "https://www.youtube.com/@crubleigh",
    crubleighRole: "MapArt Platform technical wizard",
    gu2t4vName: "Gu2t4v_",
    gu2t4vUrl: "https://youtube.com/@gust4v_",
    gu2t4vRole: "Inventor of 2-Layer suppression",
    rebaneName: "Rebane",
    rebaneUrl: "https://rebane2001.com/",
    rebaneRole: "Creator of {name}",
    mapArtCraftName: "MapArtCraft",
    mapArtCraftUrl: "https://mike2b2t.github.io/mapartcraft/",
    gptNote: "Selective coding tasks",
  },
  parsing: {
    unableToCreateImageCanvas: "Unable to create image canvas.",
    failedToDecodeImage: "Failed to decode image.",
    browserDecodeFailure: "Unable to decode this image format in the browser.",
    tiffNoImageData: "TIFF file contains no image data.",
    genericDecodeFailure: "Unable to decode this image format.",
    conversionFailed: "Conversion failed",
    blockUnavailableInVersion: "{block} is unavailable in Minecraft {version}. Choose another block or version.",
    imageSizeError: "Invalid input image dimensions",
    imageSizePadAction: "Pad to {width}×{height}",
    imageSizeCropAction: "Crop to {width}×{height}",
    imageSizePadInstead: "Pad instead",
    imageSizeCropInstead: "Crop instead",
    unsupportedPaletteColors: {
      one: "{count} color outside the Minecraft map palette.",
      other: "{count} colors outside the Minecraft map palette.",
    } as PluralForms,
    colorsOutsideCurrentPalette: {
      one: "{count} color unsupported by the current palette.",
      other: "{count} colors unsupported by the current palette.",
    } as PluralForms,
    changedValidMapColors: {
      one: "Demoted {count} color from 3D to 2D",
      other: "Demoted {count} colors from 3D to 2D",
    } as PluralForms,
    conversionPalettes: { full: "Full", current: "Preset", "current-flat": "Preset-2D" },
    convertColorsUsing: "Convert using:",
    convertColors: "Convert",
    minecraftMapPalette: "the Minecraft map palette",
    flatColorsPalette: "Flat",
    conversionSummary: {
      one: "Mapped {convertedCount} color to {palette}",
      other: "Mapped {convertedCount} colors to {palette}",
    } as PluralForms,
    upscaledImage: "Upscaled by {factor}× ({width}×{height} → {outputWidth}×{outputHeight}).",
    downscaledImage: "Downscaled by {factor}× ({width}×{height} → {outputWidth}×{outputHeight}).",
    croppedImage: "Cropped image to {width}×{height}",
    cropRemovedSingleSide: "Removed {count}px from the {side}.",
    cropRemovedPairedSides: "Removed {count}px from the {sides}.",
    paddedImage: "Padded image to {width}×{height}",
    padAddedSingleSide: "Added {count}px of transparency to the {side}.",
    padAddedPairedSides: "Added {count}px of transparency to the {sides}.",
    cropSideLeft: "left",
    cropSideRight: "right",
    cropSideTop: "top",
    cropSideBottom: "bottom",
    cropSidesLeftRight: "left/right",
    cropSidesTopBottom: "top/bottom",
    reducedUniqueColors: {
      one: "{count} fewer color than input image.",
      other: "{count} fewer colors than input image.",
    } as PluralForms,
    lossyFormatHint: "This is likely due to {formatLabel} being a lossy format.",
  },
} as const;

// Callers:
// - src/data/i18n/*
// - src/lib/messages.ts
export type MessageCatalog = WidenStrings<typeof enCatalog>;
