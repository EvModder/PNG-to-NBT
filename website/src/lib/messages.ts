/**
 * Public API:
 * - PaletteNoticeKind
 * - PaletteNotice
 * - messages
 *
 * Callers:
 * - src/Index.tsx
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PanelCredits.tsx
 * - src/components/PanelCustomColors.tsx
 * - src/components/PanelImagePreview.tsx
 * - src/components/SecretsSettingsDialog.tsx
 * - src/components/ToolbarBuildSettings.tsx
 * - src/components/ToolbarFillerSettings.tsx
 * - src/components/ToolbarPresetSettings.tsx
 * - src/lib/colorGridParsing.ts
 *
 * Notes:
 * - Selects the active locale catalog and applies interpolation/plural formatting at runtime.
 * - Locale catalogs live under `src/data/i18n/` and are intended to remain pure data only.
 */
import { unpackRgb } from "@/utils/color";
import { enCatalog, type MessageCatalog } from "@/data/i18n/en";
import { esCatalog } from "@/data/i18n/es";
import { Shade } from "@/types/color";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/types/ui";

type TemplateValues = Record<string, string | number>;

type PluralForms = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};

const CATALOGS = {
  en: enCatalog,
  es: esCatalog,
} as const satisfies Record<string, MessageCatalog>;

type SupportedLocale = keyof typeof CATALOGS;
type ActiveCatalog = MessageCatalog;

const FALLBACK_LOCALE: SupportedLocale = "en";

function resolveLocale(rawLocale?: string): SupportedLocale {
  const localeBase = rawLocale?.trim().toLowerCase().split(/[-_]/)[0];
  return localeBase && localeBase in CATALOGS ? (localeBase as SupportedLocale) : FALLBACK_LOCALE;
}

function getActiveCatalog(): ActiveCatalog {
  const browserLocale = typeof navigator !== "undefined" ? navigator.language : undefined;
  return CATALOGS[resolveLocale(browserLocale)];
}

const catalog = getActiveCatalog();
const pluralRules = new Intl.PluralRules(catalog.locale);

function formatTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

function formatPlural(forms: PluralForms, count: number, values: TemplateValues = {}): string {
  const pluralCategory = pluralRules.select(count);
  const template =
    (pluralCategory === "zero" && forms.zero) ||
    (pluralCategory === "one" && forms.one) ||
    (pluralCategory === "two" && forms.two) ||
    (pluralCategory === "few" && forms.few) ||
    (pluralCategory === "many" && forms.many) ||
    forms.other;
  return formatTemplate(template, { count, ...values });
}

function getLookupValue<T extends string>(lookup: Record<T, string>, key: T | string, fallback: string): string {
  return Object.prototype.hasOwnProperty.call(lookup, key) ? lookup[key as T] : fallback;
}

function formatRgbList(colors: number[]): string {
  return colors
    .map(color => {
      const [r, g, b] = unpackRgb(color);
      return formatTemplate(catalog.parsing.rgbColor, { r, g, b });
    })
    .join(", ");
}

function formatBlockIdList(blockIds: readonly string[]): string {
  const formatted = [...blockIds];
  if (formatted.length === 0) return "[]";
  if (formatted.length <= 3) return `[${formatted.join(", ")}]`;
  return `[${formatted[0]}, ${formatted[1]}, ... +${formatted.length - 2}]`;
}

function formatCropRemovalAxis(
  countA: number,
  sideA: string,
  countB: number,
  sideB: string,
  pairedSides: string,
): string | null {
  if (countA <= 0 && countB <= 0) return null;
  if (countA > 0 && countB > 0) {
    return formatTemplate(catalog.parsing.cropRemovedPairedSides, {
      count: Math.min(countA, countB),
      sides: pairedSides,
    });
  }
  return formatTemplate(catalog.parsing.cropRemovedSingleSide, {
    count: countA > 0 ? countA : countB,
    side: countA > 0 ? sideA : sideB,
  });
}

// Callers:
// - src/Index.tsx
// - src/components/PanelImagePreview.tsx
export enum PaletteNoticeKind {
  Freeform = "freeform",
  SizeError = "size_error",
  UnsupportedPaletteColors = "unsupported_palette_colors",
  ConvertedPaletteColors = "converted_palette_colors",
  CroppedImage = "cropped_image",
  CroppedImageRemovedPixels = "cropped_image_removed_pixels",
  ReducedUniqueColors = "reduced_unique_colors",
  LossyFormatHint = "lossy_format_hint",
}

// Callers:
// - src/Index.tsx
// - src/components/PanelImagePreview.tsx
// - src/lib/colorGridParsing.ts
export type PaletteNotice =
  | { kind: PaletteNoticeKind.Freeform; tone: "info" | "warning" | "error"; text: string }
  | { kind: PaletteNoticeKind.SizeError; width: number; height: number }
  | { kind: PaletteNoticeKind.UnsupportedPaletteColors; colors: number[] }
  | { kind: PaletteNoticeKind.ConvertedPaletteColors; convertedCount: number; totalInputColorCount: number }
  | { kind: PaletteNoticeKind.CroppedImage; width: number; height: number }
  | { kind: PaletteNoticeKind.CroppedImageRemovedPixels; left: number; right: number; top: number; bottom: number }
  | { kind: PaletteNoticeKind.ReducedUniqueColors; fewerOutputColorCount: number }
  | { kind: PaletteNoticeKind.LossyFormatHint; formatLabel: string };

// Callers:
// - src/Index.tsx
// - src/components/PanelColorBlockTable.tsx
// - src/components/PanelCredits.tsx
// - src/components/PanelCustomColors.tsx
// - src/components/PanelImagePreview.tsx
// - src/components/SecretsSettingsDialog.tsx
// - src/components/ToolbarBuildSettings.tsx
// - src/components/ToolbarFillerSettings.tsx
// - src/components/ToolbarPresetSettings.tsx
// - src/lib/colorGridParsing.ts
export const messages = {
  common: catalog.common,
  app: catalog.app,
  blocks: {
    iceWaterTooltip: catalog.blocks.iceWaterTooltip,
    iceWaterOptionTitle(blockId: string): string {
      return formatTemplate(catalog.blocks.iceWaterOptionTitle, {
        blockId,
        tooltip: catalog.blocks.iceWaterTooltip,
      });
    },
  },
  presets: {
    ...catalog.presets,
    builtinTooltip(name: string): string | undefined {
      return Object.prototype.hasOwnProperty.call(catalog.presets.builtinTooltips, name)
        ? catalog.presets.builtinTooltips[name as keyof typeof catalog.presets.builtinTooltips]
        : undefined;
    },
  },
  supportMode: {
    label: catalog.supportMode.label,
    optionLabel(mode: SupportMode | string): string {
      return getLookupValue(catalog.supportMode.optionLabels, mode, mode);
    },
    tooltip(mode: SupportMode | string): string {
      return getLookupValue(catalog.supportMode.tooltips, mode, catalog.supportMode.selectedFallbackTooltip);
    },
  },
  buildMode: {
    label: catalog.buildMode.label,
    staircaseGroupLabel: catalog.buildMode.staircaseGroupLabel,
    suppressGroupLabel: catalog.buildMode.suppressGroupLabel,
    crubTechSlimeBarLabel: catalog.buildMode.crubTechSlimeBarLabel,
    crubTechSlimeBarTooltip: catalog.buildMode.crubTechSlimeBarTooltip,
    layerGapLabel: catalog.buildMode.layerGapLabel,
    layerGapTooltip: catalog.buildMode.layerGapTooltip,
    mixStepsLabel: catalog.buildMode.mixStepsLabel,
    mixStepsTooltip: catalog.buildMode.mixStepsTooltip,
    buildAtWorldMinYLabel: catalog.buildMode.buildAtWorldMinYLabel,
    buildAtWorldMinYTooltip: catalog.buildMode.buildAtWorldMinYTooltip,
    waterLevelTooltip(shade: Shade.Dark | Shade.Flat | Shade.Light): string {
      return formatTemplate(catalog.buildMode.waterLevelTooltip, {
        shade,
        shadeName: catalog.buildMode.waterShadeNames[shade],
      });
    },
    waterLevelAriaLabel(shade: Shade.Dark | Shade.Flat | Shade.Light): string {
      return formatTemplate(catalog.buildMode.waterLevelAriaLabel, {
        shade,
        shadeName: catalog.buildMode.waterShadeNames[shade],
      });
    },
    paletteSeedLabel: catalog.buildMode.paletteSeedLabel,
    stepDirectionLabel(direction: SuppressStepDirection): string {
      return catalog.buildMode.stepDirectionLabels[direction];
    },
    stepDirectionTooltip(direction: SuppressStepDirection): string {
      return formatTemplate(catalog.buildMode.stepDirectionTooltip, {
        directionLabel: catalog.buildMode.stepDirectionLabels[direction],
      });
    },
    stepDirectionAriaLabel(direction: SuppressStepDirection): string {
      return formatTemplate(catalog.buildMode.stepDirectionAriaLabel, {
        directionLabel: catalog.buildMode.stepDirectionLabels[direction],
      });
    },
    optionLabel(mode: BuildMode | string): string {
      return getLookupValue(catalog.buildMode.optionLabels, mode, mode);
    },
    tooltip(mode: BuildMode | string): string {
      return getLookupValue(catalog.buildMode.tooltips, mode, catalog.buildMode.selectedFallbackTooltip);
    },
  },
  fillers: {
    heading: catalog.fillers.heading,
    headingTooltip: catalog.fillers.headingTooltip,
    supportLabel: catalog.fillers.supportLabel,
    supportTooltip: catalog.fillers.supportTooltip,
    supportRequiredTooltip: catalog.fillers.supportRequiredTooltip,
    shadeLabel(isNorthRowOnly: boolean): string {
      return isNorthRowOnly ? catalog.fillers.nooblineLabel : catalog.fillers.shadeLabel;
    },
    shadeTooltip(isNorthRowOnly: boolean): string {
      return isNorthRowOnly ? catalog.fillers.nooblineTooltip : catalog.fillers.shadeTooltip;
    },
    shadeRequiredTooltip(isNorthRowOnly: boolean): string {
      return isNorthRowOnly ? catalog.fillers.nooblineRequiredTooltip : catalog.fillers.shadeRequiredTooltip;
    },
    crubTechBreakableLabel: catalog.fillers.crubTechBreakableLabel,
    crubTechBreakableWarningLabel: catalog.fillers.crubTechBreakableWarningLabel,
    crubTechBreakableTooltip: catalog.fillers.crubTechBreakableTooltip,
    crubTechBreakableRequiredTooltip: catalog.fillers.crubTechBreakableRequiredTooltip,
    crubTechPushableLabel: catalog.fillers.crubTechPushableLabel,
    crubTechPushableWarningLabel: catalog.fillers.crubTechPushableWarningLabel,
    crubTechPushableTooltip: catalog.fillers.crubTechPushableTooltip,
    crubTechPushableRequiredTooltip: catalog.fillers.crubTechPushableRequiredTooltip,
    dominateVoidLabel: catalog.fillers.dominateVoidLabel,
    dominateVoidWarningLabel: catalog.fillers.dominateVoidWarningLabel,
    dominateVoidTooltip: catalog.fillers.dominateVoidTooltip,
    dominateVoidRequiredTooltip: catalog.fillers.dominateVoidRequiredTooltip,
    recessiveVoidLabel: catalog.fillers.recessiveVoidLabel,
    recessiveVoidWarningLabel: catalog.fillers.recessiveVoidWarningLabel,
    recessiveVoidTooltip: catalog.fillers.recessiveVoidTooltip,
    recessiveVoidRequiredTooltip: catalog.fillers.recessiveVoidRequiredTooltip,
    voidFillersWarningLabel: catalog.fillers.voidFillersWarningLabel,
    lateLabel: catalog.fillers.lateLabel,
    lateTooltip: catalog.fillers.lateTooltip,
    lateRequiredTooltip: catalog.fillers.lateRequiredTooltip,
  },
  table: {
    title: catalog.table.title,
    titleTooltip: catalog.table.titleTooltip,
    toggleIds: catalog.table.toggleIds,
    toggleNames: catalog.table.toggleNames,
    toggleOptions: catalog.table.toggleOptions,
    toggleBlockDisplayTitle: catalog.table.toggleBlockDisplayTitle,
    blockDisplayMode(mode: BlockDisplayMode | string): string {
      return getLookupValue(catalog.table.blockDisplayLabels, mode, mode);
    },
    mcUnitsLabel: catalog.table.mcUnitsLabel,
    mcUnitsTooltip: catalog.table.mcUnitsTooltip,
    maxPerSplitLabel: catalog.table.maxPerSplitLabel,
    maxPerSplitTooltip: catalog.table.maxPerSplitTooltip,
    columnLabel(column: ColumnId | string): string {
      return getLookupValue(catalog.table.columnLabels, column, column);
    },
    columnSortTitle(column: ColumnId | string): string {
      return getLookupValue(catalog.table.columnSortTitles, column, "");
    },
    blockColumnResizeTitle(isExpanded: boolean): string {
      return isExpanded ? catalog.table.blockColumnResizeExpanded : catalog.table.blockColumnResizeCollapsed;
    },
    blockColumnResizeAriaLabel(isExpanded: boolean): string {
      return isExpanded ? catalog.table.blockColumnAriaExpanded : catalog.table.blockColumnAriaCollapsed;
    },
    unusedColorsLabel(count: number): string {
      return formatPlural(catalog.table.unusedColorsLabel, count);
    },
  },
  customColors: {
    title: catalog.customColors.title,
    tooltip: catalog.customColors.tooltip,
    ariaLabel: catalog.customColors.ariaLabel,
    customRgbOption: catalog.customColors.customRgbOption,
    blockLabel: catalog.customColors.blockLabel,
    blockPlaceholder: catalog.customColors.blockPlaceholder,
    usedInImage(count: number): string {
      return formatPlural(catalog.customColors.usedInImage, count);
    },
    unusedLabel(count: number): string {
      return formatPlural(catalog.customColors.unusedLabel, count);
    },
    channelLabel(channel: string): string {
      return channel.toUpperCase();
    },
  },
  upload: {
    title: catalog.upload.title,
    placeholder: catalog.upload.placeholder,
    showVsFillersToggle: catalog.upload.showVsFillersToggle,
    showVsFillersTooltip: catalog.upload.showVsFillersTooltip,
    copyImageUrlTitle: catalog.upload.copyImageUrlTitle,
    copiedImageUrlAlert: catalog.upload.copiedImageUrlAlert,
    sharedImageName: catalog.upload.sharedImageName,
    removeButton: catalog.upload.removeButton,
    cancelButton: catalog.upload.cancelButton,
    parsing: catalog.upload.parsing,
    parsingProgress(completed: number, total: number): string {
      return formatTemplate(catalog.upload.parsingProgress, { completed, total });
    },
    analyzing: catalog.upload.analyzing,
    analyzingProgress(completed: number, total: number): string {
      return formatTemplate(catalog.upload.analyzingProgress, { completed, total });
    },
    fillerAnalysis: catalog.upload.fillerAnalysis,
    fillerAnalysisProgress(completed: number, total: number): string {
      return formatTemplate(catalog.upload.fillerAnalysisProgress, { completed, total });
    },
    materialAnalysis: catalog.upload.materialAnalysis,
    materialAnalysisProgress(completed: number, total: number): string {
      return formatTemplate(catalog.upload.materialAnalysisProgress, { completed, total });
    },
    convertButton(isConverting: boolean, isZip: boolean): string {
      if (isConverting) return catalog.upload.convertButtonConverting;
      return isZip ? catalog.upload.convertButtonZip : catalog.upload.convertButtonNbt;
    },
    convertButtonZipCount(count: number): string {
      return formatTemplate(catalog.upload.convertButtonZipCount, { count });
    },
  },
  preview: {
    missingBlockAssignments(count: number): string {
      return formatPlural(catalog.preview.missingBlockAssignments, count);
    },
    northRowAlignmentInfo: catalog.preview.northRowAlignmentInfo,
    iceConversionInfo: catalog.preview.iceConversionInfo,
    iceConversionWarning: catalog.preview.iceConversionWarning,
    noFillerNorthRowLine: catalog.preview.noFillerNorthRowLine,
    noFillerSuppressLine: catalog.preview.noFillerSuppressLine,
    noFillerInGridLine: catalog.preview.noFillerInGridLine,
    noFillerWarning(value: string, lines: string[]): string {
      return formatTemplate(catalog.preview.noFillerWarning, {
        value,
        lines: lines.join("\n"),
      });
    },
    crubTechBreakableInvalid(value: string, count: number): string {
      return formatPlural(catalog.preview.crubTechBreakableInvalid, count, { value });
    },
    crubTechPushableInvalid(value: string, count: number): string {
      return formatPlural(catalog.preview.crubTechPushableInvalid, count, { value });
    },
    crubTechBreakableBehaviorWarning(value: string, count: number): string {
      return formatPlural(catalog.preview.crubTechBreakableBehaviorWarning, count, { value });
    },
    crubTechPushableBehaviorWarning(value: string, count: number): string {
      return formatPlural(catalog.preview.crubTechPushableBehaviorWarning, count, { value });
    },
    waterSideSupportWarning(value: string, isInvalid: boolean): string {
      return formatTemplate(
        isInvalid ? catalog.preview.waterSideSupportInvalid : catalog.preview.waterSideSupportNotColorIdZero,
        { value },
      );
    },
    fragileSupportOverrideWarning(blockId: string, validSupportBlocks: readonly string[]): string {
      if (validSupportBlocks.length === 1) {
        return formatTemplate(catalog.preview.fragileSupportOverrideWarningSingle, {
          blockId,
          support: validSupportBlocks[0],
        });
      }
      return formatTemplate(catalog.preview.fragileSupportOverrideWarning, {
        blockId,
        supports: formatBlockIdList(validSupportBlocks),
      });
    },
    vsFillerInvalid(label: string, value: string, noobPixels: number): string {
      return formatPlural(catalog.preview.vsFillerInvalid, noobPixels, {
        label,
        value,
      });
    },
    vsFillerRequired(label: string, pixels: number, isPluralLabel = false): string {
      return formatPlural(
        isPluralLabel ? catalog.preview.vsFillerRequiredPluralLabel : catalog.preview.vsFillerRequiredSingularLabel,
        pixels,
        {
        label,
        },
      );
    },
    vsFillersInvalid(values: [string, string], pixels: number): string {
      return formatPlural(catalog.preview.vsFillersInvalid, pixels, {
        first: values[0],
        second: values[1],
      });
    },
    vsFillerTransparentSwap(value: string): string {
      return formatTemplate(catalog.preview.vsFillerTransparentSwap, { value });
    },
    lateFillerInvalid(value: string, count: number): string {
      return formatPlural(catalog.preview.lateFillerInvalid, count, {
        value,
      });
    },
    suppressStepNorthSouthWarning(modeLabel: string, directionLabel: string): string {
      return formatTemplate(catalog.preview.suppressStepNorthSouthWarning, {
        modeLabel,
        directionLabel,
      });
    },
    uniqueColorCount(count: number): string {
      return formatPlural(catalog.preview.uniqueColorCount, count);
    },
    blockTypeCount(count: number): string {
      return formatPlural(catalog.preview.blockTypeCount, count);
    },
    voidShadowCount(count: number): string {
      return formatPlural(catalog.preview.voidShadowCount, count);
    },
    rangeButtonLabel(isStepRangeMode: boolean): string {
      return isStepRangeMode ? catalog.preview.stepRangeButton : catalog.preview.columnRangeButton;
    },
  },
  swatches: {
    transparent: catalog.swatches.transparent,
    shadeTooltip(hex: string, shade: Shade): string {
      return formatTemplate(catalog.swatches.shadeTooltip, {
        hex,
        shadeId: String(shade),
      });
    },
  },
  dialogs: catalog.dialogs,
  credits: {
    ...catalog.credits,
    rebaneRole(name: string): string {
      return formatTemplate(catalog.credits.rebaneRole, { name });
    },
    rebaneRoleParts(): [string, string] {
      const [before = "", after = ""] = catalog.credits.rebaneRole.split("{name}");
      return [before, after];
    },
  },
  parsing: {
    unableToCreateImageCanvas: catalog.parsing.unableToCreateImageCanvas,
    failedToDecodeImage: catalog.parsing.failedToDecodeImage,
    browserDecodeFailure: catalog.parsing.browserDecodeFailure,
    tiffNoImageData: catalog.parsing.tiffNoImageData,
    genericDecodeFailure: catalog.parsing.genericDecodeFailure,
    conversionFailed: catalog.parsing.conversionFailed,
    imageSizeNotice(width: number, height: number): PaletteNotice {
      return { kind: PaletteNoticeKind.SizeError, width, height };
    },
    unsupportedPaletteColorsNotice(colors: number[]): PaletteNotice {
      return { kind: PaletteNoticeKind.UnsupportedPaletteColors, colors };
    },
    convertedPaletteColorsNotice(convertedCount: number, totalInputColorCount: number): PaletteNotice {
      return { kind: PaletteNoticeKind.ConvertedPaletteColors, convertedCount, totalInputColorCount };
    },
    croppedImageNotice(width: number, height: number): PaletteNotice {
      return { kind: PaletteNoticeKind.CroppedImage, width, height };
    },
    croppedImageRemovedPixelsNotice(left: number, right: number, top: number, bottom: number): PaletteNotice {
      return { kind: PaletteNoticeKind.CroppedImageRemovedPixels, left, right, top, bottom };
    },
    reducedUniqueColorsNotice(fewerOutputColorCount: number): PaletteNotice {
      return { kind: PaletteNoticeKind.ReducedUniqueColors, fewerOutputColorCount };
    },
    lossyFormatHintNotice(formatLabel: string): PaletteNotice {
      return { kind: PaletteNoticeKind.LossyFormatHint, formatLabel };
    },
    errorNotice(text: string): PaletteNotice {
      return { kind: PaletteNoticeKind.Freeform, tone: "error", text };
    },
    noticeText(notice: PaletteNotice): string {
      switch (notice.kind) {
        case PaletteNoticeKind.Freeform:
          return notice.text;
        case PaletteNoticeKind.SizeError:
          return formatTemplate(catalog.parsing.imageSizeError, {
            width: notice.width,
            height: notice.height,
          });
        case PaletteNoticeKind.UnsupportedPaletteColors: {
          const shown = notice.colors.slice(0, 10);
          return formatPlural(catalog.parsing.unsupportedPaletteColors, notice.colors.length, {
            colors: formatRgbList(shown),
            ellipsis: notice.colors.length > 10 ? "..." : "",
          });
        }
        case PaletteNoticeKind.ConvertedPaletteColors:
          return notice.convertedCount === notice.totalInputColorCount || notice.totalInputColorCount >= 1000
            ? formatPlural(catalog.parsing.conversionSummaryAll, notice.convertedCount, {
                convertedCount: notice.convertedCount,
              })
            : formatPlural(catalog.parsing.conversionSummaryPartial, notice.totalInputColorCount, {
                convertedCount: notice.convertedCount,
                totalInputColorCount: notice.totalInputColorCount,
              });
        case PaletteNoticeKind.CroppedImage:
          return formatTemplate(catalog.parsing.croppedImage, {
            width: notice.width,
            height: notice.height,
          });
        case PaletteNoticeKind.CroppedImageRemovedPixels: {
          const lines = [
            formatCropRemovalAxis(
              notice.left,
              catalog.parsing.cropSideLeft,
              notice.right,
              catalog.parsing.cropSideRight,
              catalog.parsing.cropSidesLeftRight,
            ),
            formatCropRemovalAxis(
              notice.top,
              catalog.parsing.cropSideTop,
              notice.bottom,
              catalog.parsing.cropSideBottom,
              catalog.parsing.cropSidesTopBottom,
            ),
          ].filter((line): line is string => !!line);
          return lines.join("\n");
        }
        case PaletteNoticeKind.ReducedUniqueColors:
          return formatPlural(catalog.parsing.reducedUniqueColors, notice.fewerOutputColorCount, {
            count: notice.fewerOutputColorCount,
          });
        case PaletteNoticeKind.LossyFormatHint:
          return formatTemplate(catalog.parsing.lossyFormatHint, { formatLabel: notice.formatLabel });
      }
    },
    noticeTone(notice: PaletteNotice): "info" | "warning" | "error" {
      switch (notice.kind) {
        case PaletteNoticeKind.Freeform:
          return notice.tone;
        case PaletteNoticeKind.SizeError:
        case PaletteNoticeKind.UnsupportedPaletteColors:
        case PaletteNoticeKind.CroppedImageRemovedPixels:
        case PaletteNoticeKind.ReducedUniqueColors:
          return "error";
        case PaletteNoticeKind.CroppedImage:
        case PaletteNoticeKind.ConvertedPaletteColors:
        case PaletteNoticeKind.LossyFormatHint:
          return "warning";
      }
    },
    bannerTone(notices: PaletteNotice[]): "info" | "warning" | "error" {
      if (notices.some(notice =>
        notice.kind === PaletteNoticeKind.SizeError ||
        notice.kind === PaletteNoticeKind.UnsupportedPaletteColors ||
        (notice.kind === PaletteNoticeKind.Freeform && notice.tone === "error")
      )) {
        return "error";
      }
      if (notices.length > 0) return "warning";
      return "info";
    },
  },
} as const;
