/**
 * Public API:
 * - enCatalog
 * - MessageCatalog
 *
 * Callers:
 * - src/data/i18n/*
 * - src/lib/messages.ts
 */
import { type Shade } from "@/data/mapColors";
import { BuildMode } from "@/lib/conversionTypes";
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/lib/uiTypes";

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
    share: "Share",
    deleteShort: "Del",
    clearSelectionSymbol: "∅",
    missingTextureSymbol: "?",
    openSecretsSettings: "Open secrets settings",
    toggleThemeAriaLabel: "Toggle theme",
    unsavedChanges: "Unsaved changes",
    newPresetTitle: "New preset",
  },
  app: {
    title: "Image → NBT",
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
    copiedUrlAlert: "Preset URL copied to clipboard!",
    namePrompt: "Enter preset name:",
    builtinTooltips: {
      Fullblock: "Fast-to-mine, high visual contrast (easily distinguishable) full blocks.",
      Carpets: "Just carpets, cheapest and easiest.",
      PistonClear: "Piston-clearables for use with a non-TNT/nuker auto-resetting platform.",
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
      [SupportMode.Steps]: "Adds support blocks below staircase steps.",
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
    layerGapLabel: "Layer gap:",
    layerGapTooltip: "Layer gap controls the vertical spacing between lower and upper 2-layer suppress sections.",
    mixStepsLabel: "Mix Steps:",
    mixStepsTooltip:
      "Sequential steps are able to reusable (recessive) color blocks from prior steps as flat-shade providers, reducing block churn between steps but slightly complicating the process (by expecting you to keep these blocks between phases).",
    paletteSeedLabel: "Palette Seed:",
    optionLabels: {
      [BuildMode.Flat]: "Flat",
      [BuildMode.InclineUp]: "Incline (Up)",
      [BuildMode.InclineDown]: "Incline (Down)",
      [BuildMode.StaircaseNorthline]: "Staircase (Northline)",
      [BuildMode.StaircaseSouthline]: "Staircase (Southline)",
      [BuildMode.StaircaseClassic]: "Staircase (Classic)",
      [BuildMode.StaircaseValley]: "Staircase (Valley)",
      [BuildMode.StaircaseGrouped]: "Staircase (Grouped)",
      [BuildMode.StaircaseParty]: "Staircase (Party)",
      [BuildMode.SuppressSplitRow]: "Suppress (Row-split)",
      [BuildMode.SuppressSplitChecker]: "Suppress (Checker-split)",
      [BuildMode.SuppressCheckerEW]: "Suppress (Checker, E→W)",
      [BuildMode.SuppressPairsEW]: "Suppress (Pairs, E→W)",
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
      [BuildMode.StaircaseGrouped]: "Valley-style segmentation with safe cross-column grouping to reduce isolated low runs",
      [BuildMode.StaircaseParty]: "Same MapArt, but makes the build process more fun and exciting!",
      [BuildMode.SuppressSplitRow]: "Split-row; available for compatibility, but generally not useful",
      [BuildMode.SuppressSplitChecker]: "Split NBT generations for dominant/recessive placements",
      [BuildMode.SuppressCheckerEW]:
        "Like Suppress (2-Layer), but encoded as vertically separated E→W phases instead of upper/lower layers. Each step handles 4 columns: 2 farther dominant columns and 2 nearer recessive columns. Build/update one step, then rebuild the next step farther away so the dominant columns remap without remapping the nearer recessive ones.",
      [BuildMode.SuppressPairsEW]:
        "Stepwise E→W suppress in interlaced pairs. Each step updates one farther dominant pixel and one nearer recessive pixel from adjacent columns, then the next step is rebuilt farther away so the dominant pixel can be remapped without remapping the recessive one.",
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
    headingTooltip: "Filler block assignments for support, shading, and special-case placements.",
    supportLabel: "Support:",
    supportTooltip:
      "Used for support and convenience filler placements, including Steps, All, Fragile, Water support, and water-path connectors.",
    supportPlaceholder: "resin_block",
    supportRequiredTooltip: "Required support/convenience filler placements for the current output range.",
    shadeLabel: "Shade:",
    nooblineLabel: "Noobline:",
    shadeTooltip: "Used for north-row and suppress shading filler placements.",
    nooblineTooltip: "Used for north-row shading filler placements.",
    shadeRequiredTooltip: "Required north-row and suppress-shading filler placements for the current output range.",
    nooblineRequiredTooltip: "Required north-row shading filler placements for the current output range.",
    dominateVoidLabel: "VS-1:",
    dominateVoidWarningLabel: "VS-Filler-1",
    dominateVoidTooltip:
      "Used when a dominate transparent pixel is overwritten by a filler block to shade the block directly south. This filler will need to be manually suppressed after building the NBT.",
    dominateVoidPlaceholder: "slime_block",
    dominateVoidRequiredTooltip: "Required VS-Filler-1 placements for the current output range.",
    recessiveVoidLabel: "VS-2:",
    recessiveVoidWarningLabel: "VS-Filler-2",
    recessiveVoidTooltip:
      "Used when a recessive transparent pixel is overwritten by a filler block to shade the block directly south. This filler will need to be manually suppressed after building the NBT.",
    recessiveVoidPlaceholder: "honey_block",
    recessiveVoidRequiredTooltip: "Required VS-Filler-2 placements for the current output range.",
    voidFillersWarningLabel: "VS-Fillers",
    lateLabel: "Late:",
    lateTooltip: "Used by Suppress (2-Layer, Late-Fillers) for late lower-layer suppress placements.",
    latePlaceholder: "slime_block",
    lateRequiredTooltip: "Required late suppress filler placements for the current output range.",
  },
  table: {
    title: "Color → Block",
    toggleIds: "IDs",
    toggleNames: "Names",
    toggleOptions: "#Options",
    toggleBlockDisplayTitle: "Toggle block display mode",
    blockDisplayLabels: {
      names: "names",
      textures: "textures",
    } as const satisfies Record<BlockDisplayMode, string>,
    mcUnitsLabel: "MC units:",
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
    title: "Custom Color Mappings",
    tooltip:
      "Custom RGB is interpreted as the base/light shade for the color ID.\nDark and flat shades are derived automatically using standard multipliers.\nOnce added, all three new shades will be available to use for input images.",
    ariaLabel: "Custom color shading info",
    customRgbOption: "Custom RGB",
    blockLabel: "Block",
    blockPlaceholder: "e.g. fart_block",
  },
  upload: {
    title: "Image Preview",
    placeholder: "Click or drop a 128×128 image",
    removeButton: "Remove",
    convertButtonConverting: "Converting...",
    convertButtonNbt: "Generate .nbt",
    convertButtonZip: "Generate .zip",
  },
  preview: {
    missingBlockAssignments: {
      one: "{count} color in the image has no block assigned in the preset.",
      other: "{count} colors in the image have no block assigned in the preset.",
    } as PluralForms,
    northRowAlignmentInfo:
      "Note: Align 128x128 color area to the map grid.\nExpect 1 extra top north row (NBT is 128x129).",
    iceConversionInfo:
      "Note: Ice has been selected for water-color.\nConvert it to water in-game for colors to be accurate.",
    noFillerNorthRowLine: "North-row shading requires filler placements.",
    noFillerSuppressLine: "Suppress-shading requires filler placements.",
    noFillerInGridLine: "Some shading-critical fillers are required inside the 128x128 grid.",
    noFillerWarning: "Shade-Filler is disabled ({value}).\n{lines}",
    waterSideSupportInvalid:
      "Support filler is invalid ({value}).\nSome water-side supports require a color_id=0 block, so those placements will not be counted or exported.",
    waterSideSupportNotColorIdZero:
      "Support filler is not color_id=0 ({value}).\nSome water-side supports require a color_id=0 block, so those placements will not be counted or exported.",
    vsFillerInvalid: {
      one: "{label} is invalid ({value}).\nThere will be {count} noob pixel.",
      other: "{label} is invalid ({value}).\nThere will be {count} noob pixels.",
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
      one: "VS-Fillers are invalid ({first}, {second}). There will be {count} noob pixel (south-of-transparent with incorrect shading).",
      other:
        "VS-Fillers are invalid ({first}, {second}). There will be {count} noob pixels (south-of-transparent with incorrect shading).",
    } as PluralForms,
    lateFillerInvalid: {
      one: "Late-Filler is invalid ({value}).\n{count} late suppress spot requires shading.",
      other: "Late-Filler is invalid ({value}).\n{count} late suppress spots require shading.",
    } as PluralForms,
    uniqueColorCount: {
      one: "{count} unique color",
      other: "{count} unique colors",
    } as PluralForms,
    blockTypeCount: {
      one: "{count} block type",
      other: "{count} block types",
    } as PluralForms,
    voidShadowCount: {
      one: "{count} void shadow",
      other: "{count} void shadows",
    } as PluralForms,
    stepRangeButton: "Step range",
    columnRangeButton: "Column range",
  },
  swatches: {
    transparent: "Transparent",
    shadeLabels: {
      0: "dark",
      1: "flat",
      2: "light",
      3: "darkest (unobtainable)",
    } as const satisfies Record<Shade, string>,
    shadeTooltip: "{hex} - Click to copy ({shade})",
  },
  dialogs: {
    secretSettingsTitle: "Secret Settings",
    options: {
      showTransparentRow: "Show color_id=0 row",
      showExcludedBlocks: "Show excluded blocks",
      forceZ129: "Z-width always 129",
      assumeFloor: "Assume floor",
      showAlignmentReminder: "Show alignment reminder",
      showNooblineWarnings: "Show warnings for nooblines",
      showVsFillerWarnings: "Show warnings when VS-Fillers are required in Staircase maps",
    },
  },
  credits: {
    title: "Credits",
    evModderName: "EvModder",
    evModderUrl: "https://www.youtube.com/@evmodder",
    evModderRole: "Developer",
    rebaneName: "Rebane2001",
    rebaneUrl: "https://rebane2001.com/",
    rebaneRole: "Original creator of {name}",
    mapArtCraftName: "MapArtCraft",
    mapArtCraftUrl: "https://mike2b2t.github.io/mapartcraft/",
    gu2t4vName: "Gu2t4v",
    gu2t4vUrl: "https://youtube.com/@gust4v_",
    gu2t4vRole: "Suppression expert, inventor of 2-Layer method",
    gptNote: "Note: GPT was used for parts of this site",
  },
  parsing: {
    unableToCreateImageCanvas: "Unable to create image canvas.",
    failedToDecodeImage: "Failed to decode image.",
    browserDecodeFailure: "Unable to decode this image format in the browser.",
    tiffNoImageData: "TIFF file contains no image data.",
    genericDecodeFailure: "Unable to decode this image format.",
    conversionFailed: "Conversion failed",
    imageSizeError: "Image must be 128×128 pixels (got {width}×{height})",
    unsupportedPaletteColors: {
      one: "Found {count} color not in Minecraft map palette:\n\n{colors}{ellipsis}",
      other: "Found {count} colors not in Minecraft map palette:\n\n{colors}{ellipsis}",
    } as PluralForms,
    rgbColor: "rgb({r},{g},{b})",
    conversionSummaryAll: {
      one: "Converted {convertedCount} color to nearest palette id.",
      other: "Converted {convertedCount} colors to nearest palette id.",
    } as PluralForms,
    conversionSummaryPartial: {
      one: "Converted {convertedCount} (of {totalInputColorCount}) color to nearest palette id.",
      other: "Converted {convertedCount} (of {totalInputColorCount}) colors to nearest palette id.",
    } as PluralForms,
    reducedUniqueColors: {
      one: "{count} fewer unique color than source image.",
      other: "{count} fewer unique colors than source image.",
    } as PluralForms,
    lossyFormatHint: "This is likely due to {formatLabel} being a lossy format.",
  },
} as const;

// Callers:
// - src/data/i18n/*
// - src/lib/messages.ts
export type MessageCatalog = WidenStrings<typeof enCatalog>;
