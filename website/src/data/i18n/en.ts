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
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/types/ui";

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
    clearSelectionSymbol: "∅",
    missingTextureSymbol: "?",
    openSecretsSettings: "Open secret settings",
    toggleThemeAriaLabel: "Toggle theme",
    unsavedChanges: "Unsaved changes",
    newPresetTitle: "Name new preset from current settings",
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
    copiedUrlAlert: "URL copied to clipboard!",
    namePrompt: "Enter preset name:",
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
    crubTechLabel: "CrubTech",
    crubTechTooltip:
      "For 2-layer suppress builds, split upper shading fillers into breakable and pushable variants so east-west adjacent shade fillers do not all use the same CrubTech behavior.",
    latePairsGapLabel: "Late-pairs gap:",
    latePairsGapTooltip: "Vertical gap above the normal upper 2-layer block used for late-pair placements added during each suppress update phase.",
    layerGapLabel: "Layer gap:",
    layerGapTooltip: "Layer gap controls the vertical spacing between lower and upper 2-layer suppress sections.",
    mixStepsLabel: "Printer+Nuker:",
    mixStepsTooltip:
      "Adjacent suppress steps can reuse prior-step recessive color blocks as flat-shade providers, reducing block churn between steps but slightly complicating the process (by expecting you to keep these blocks between phases).",
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
    paletteSeedLabel: "Palette Seed:",
    stepDirectionLabels: {
      [SuppressStepDirection.EastToWest]: "E→W",
      [SuppressStepDirection.WestToEast]: "W→E",
      [SuppressStepDirection.NorthToSouth]: "N→S",
      [SuppressStepDirection.SouthToNorth]: "S→N",
    } as const satisfies Record<SuppressStepDirection, string>,
    stepDirectionTooltip: "Suppression direction: {directionLabel}. Click to cycle.",
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
    crubTechBreakableWarningLabel: "Shade-Breakable",
    crubTechBreakableTooltip:
      "Used for CrubTech 2-layer shading spots that should break when pushed by piston/slime.",
    crubTechBreakableRequiredTooltip:
      "Required CrubTech breakable shading filler placements for the current output range.",
    crubTechPushableLabel: "Shade-Pushable:",
    crubTechPushableWarningLabel: "Shade-Pushable",
    crubTechPushableTooltip:
      "Used for CrubTech 2-layer shading spots that must remain pushable by piston/slime.",
    crubTechPushableRequiredTooltip:
      "Required CrubTech pushable shading filler placements for the current output range.",
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
    iceConversionWarning:
      "Warning: Ice has been selected for water-color.\nThis build contains floating ice pillars.\nIce cannot convert to water unless the pillar has support beneath it.",
    noFillerNorthRowLine: "North-row shading requires filler placements.",
    noFillerSuppressLine: "Suppress-shading requires filler placements.",
    noFillerInGridLine: "Some shading-critical fillers are required inside the 128x128 grid.",
    noFillerWarning: "Shade-Filler is disabled ({value}).\n{lines}",
    crubTechBreakableInvalid: {
      one: "Shade-Breakable is invalid ({value}).\n{count} CrubTech shading spot requires it.",
      other: "Shade-Breakable is invalid ({value}).\n{count} CrubTech shading spots require it.",
    } as PluralForms,
    crubTechPushableInvalid: {
      one: "Shade-Pushable is invalid ({value}).\n{count} CrubTech shading spot requires it.",
      other: "Shade-Pushable is invalid ({value}).\n{count} CrubTech shading spots require it.",
    } as PluralForms,
    crubTechBreakableBehaviorWarning: {
      one: "Shade-Breakable should break when pushed by piston/slime ({value}).\n{count} CrubTech shading spot uses it.",
      other: "Shade-Breakable should break when pushed by piston/slime ({value}).\n{count} CrubTech shading spots use it.",
    } as PluralForms,
    crubTechPushableBehaviorWarning: {
      one: "Shade-Pushable should remain pushable by piston/slime ({value}).\n{count} CrubTech shading spot uses it.",
      other: "Shade-Pushable should remain pushable by piston/slime ({value}).\n{count} CrubTech shading spots use it.",
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
      one: "{label} is invalid ({value}).\nThere will be {count} staircase pixel with incorrect shading.",
      other: "{label} is invalid ({value}).\nThere will be {count} staircase pixels with incorrect shading.",
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
      one: "VS-Fillers are invalid ({first}, {second}). There will be {count} staircase pixel with incorrect shading.",
      other:
        "VS-Fillers are invalid ({first}, {second}). There will be {count} staircase pixels with incorrect shading.",
    } as PluralForms,
    vsFillerTransparentSwap: "Swap flat-shade VS-Fillers for {value}.",
    lateFillerInvalid: {
      one: "Late-Filler is invalid ({value}).\n{count} late suppress spot requires shading.",
      other: "Late-Filler is invalid ({value}).\n{count} late suppress spots require shading.",
    } as PluralForms,
    suppressStepNorthSouthWarning:
      "Warning: {modeLabel} N→S / S→N places north/south blocks in the same phase.\nTo preserve shading, this causes some blocks to be lifted by 1 Y, making the overall build less intuitive and compact.",
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
  },
  swatches: {
    transparent: "Transparent",
    shadeTooltip: "{shadeId}: {hex} | Click to copy",
  },
  dialogs: {
    secretSettingsTitle: "Secret Settings",
    options: {
      showTransparentRow: "Show color_id=0 row",
      showExcludedBlocks: "Show excluded blocks",
      collapseDuplicateNbtPaletteStates: "Collapse duplicate NBT palette states",
      forceXZ128: "XZ-width always 128",
      forceZ129: "Z-width always 129",
      assumeFloor: "Assume floor",
      belowPlatformWater: "Below-platform water",
      skipEmptySuppressSteps: "Skip empty suppress steps",
      showFlatNbtSuppressStepModes: "Show suppress (steps) options for Flat schematics",
      markSuppressLoadSpotsInSchematic: "Mark color-suppress load-spots in schematics",
      suppressLoadSpotMarkerBlock: "Marker block",
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
    gptNote: "ChatGPT — Sorry, I'm not above using AI (selective tasks)",
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
    croppedImage: "Cropped image to {width}×{height}.",
    cropRemovedSingleSide: "Removed {count}px from the {side}.",
    cropRemovedPairedSides: "Removed {count}px from the {sides}.",
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
