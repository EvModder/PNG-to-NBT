/**
 * Public API:
 * - PaletteNoticeKind
 * - PaletteNotice
 * - messages
 *
 * Callers:
 * - src/Index.tsx
 * - src/lib/colorGridParsing.ts
 *
 * Notes:
 * - Selects the active locale catalog and applies interpolation/plural formatting at runtime.
 * - Locale catalogs live under `src/data/i18n/` and are intended to remain pure data only.
 */
import { unpackRgb, type Shade } from "@/data/mapColors";
import { enCatalog, type MessageCatalog } from "@/data/i18n/en";
import { esCatalog } from "@/data/i18n/es";
import { BuildMode } from "@/lib/conversionTypes";
import { type BlockDisplayMode, type ColumnId, SupportMode } from "@/lib/uiTypes";

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

// Callers:
// - src/Index.tsx
// - src/lib/colorGridParsing.ts
export enum PaletteNoticeKind {
  Freeform = "freeform",
  SizeError = "size_error",
  UnsupportedPaletteColors = "unsupported_palette_colors",
  ConvertedPaletteColors = "converted_palette_colors",
  ReducedUniqueColors = "reduced_unique_colors",
  LossyFormatHint = "lossy_format_hint",
}

// Callers:
// - src/Index.tsx
// - src/lib/colorGridParsing.ts
export type PaletteNotice =
  | { kind: PaletteNoticeKind.Freeform; tone: "info" | "warning" | "error"; text: string }
  | { kind: PaletteNoticeKind.SizeError; width: number; height: number }
  | { kind: PaletteNoticeKind.UnsupportedPaletteColors; colors: number[] }
  | { kind: PaletteNoticeKind.ConvertedPaletteColors; convertedCount: number; totalInputColorCount: number }
  | { kind: PaletteNoticeKind.ReducedUniqueColors; fewerOutputColorCount: number }
  | { kind: PaletteNoticeKind.LossyFormatHint; formatLabel: string };

// Callers:
// - src/Index.tsx
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
    layerGapLabel: catalog.buildMode.layerGapLabel,
    layerGapTooltip: catalog.buildMode.layerGapTooltip,
    mixStepsLabel: catalog.buildMode.mixStepsLabel,
    mixStepsTooltip: catalog.buildMode.mixStepsTooltip,
    paletteSeedLabel: catalog.buildMode.paletteSeedLabel,
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
    supportPlaceholder: catalog.fillers.supportPlaceholder,
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
    dominateVoidLabel: catalog.fillers.dominateVoidLabel,
    dominateVoidWarningLabel: catalog.fillers.dominateVoidWarningLabel,
    dominateVoidTooltip: catalog.fillers.dominateVoidTooltip,
    dominateVoidPlaceholder: catalog.fillers.dominateVoidPlaceholder,
    dominateVoidRequiredTooltip: catalog.fillers.dominateVoidRequiredTooltip,
    recessiveVoidLabel: catalog.fillers.recessiveVoidLabel,
    recessiveVoidWarningLabel: catalog.fillers.recessiveVoidWarningLabel,
    recessiveVoidTooltip: catalog.fillers.recessiveVoidTooltip,
    recessiveVoidPlaceholder: catalog.fillers.recessiveVoidPlaceholder,
    recessiveVoidRequiredTooltip: catalog.fillers.recessiveVoidRequiredTooltip,
    voidFillersWarningLabel: catalog.fillers.voidFillersWarningLabel,
    lateLabel: catalog.fillers.lateLabel,
    lateTooltip: catalog.fillers.lateTooltip,
    latePlaceholder: catalog.fillers.latePlaceholder,
    lateRequiredTooltip: catalog.fillers.lateRequiredTooltip,
  },
  table: {
    title: catalog.table.title,
    toggleIds: catalog.table.toggleIds,
    toggleNames: catalog.table.toggleNames,
    toggleOptions: catalog.table.toggleOptions,
    toggleBlockDisplayTitle: catalog.table.toggleBlockDisplayTitle,
    blockDisplayMode(mode: BlockDisplayMode | string): string {
      return getLookupValue(catalog.table.blockDisplayLabels, mode, mode);
    },
    mcUnitsLabel: catalog.table.mcUnitsLabel,
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
    channelLabel(channel: string): string {
      return channel.toUpperCase();
    },
  },
  upload: {
    title: catalog.upload.title,
    placeholder: catalog.upload.placeholder,
    removeButton: catalog.upload.removeButton,
    convertButton(isConverting: boolean, isZip: boolean): string {
      if (isConverting) return catalog.upload.convertButtonConverting;
      return isZip ? catalog.upload.convertButtonZip : catalog.upload.convertButtonNbt;
    },
  },
  preview: {
    missingBlockAssignments(count: number): string {
      return formatPlural(catalog.preview.missingBlockAssignments, count);
    },
    northRowAlignmentInfo: catalog.preview.northRowAlignmentInfo,
    iceConversionInfo: catalog.preview.iceConversionInfo,
    noFillerNorthRowLine: catalog.preview.noFillerNorthRowLine,
    noFillerSuppressLine: catalog.preview.noFillerSuppressLine,
    noFillerInGridLine: catalog.preview.noFillerInGridLine,
    noFillerWarning(value: string, lines: string[]): string {
      return formatTemplate(catalog.preview.noFillerWarning, {
        value,
        lines: lines.join("\n"),
      });
    },
    waterSideSupportWarning(value: string, isInvalid: boolean): string {
      return formatTemplate(
        isInvalid ? catalog.preview.waterSideSupportInvalid : catalog.preview.waterSideSupportNotColorIdZero,
        { value },
      );
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
    lateFillerInvalid(value: string, count: number): string {
      return formatPlural(catalog.preview.lateFillerInvalid, count, {
        value,
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
        shade: catalog.swatches.shadeLabels[shade],
      });
    },
  },
  dialogs: catalog.dialogs,
  credits: {
    ...catalog.credits,
    rebaneRole(name: string): string {
      return formatTemplate(catalog.credits.rebaneRole, { name });
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
          return notice.convertedCount === notice.totalInputColorCount
            ? formatPlural(catalog.parsing.conversionSummaryAll, notice.convertedCount, {
                convertedCount: notice.convertedCount,
              })
            : formatPlural(catalog.parsing.conversionSummaryPartial, notice.totalInputColorCount, {
                convertedCount: notice.convertedCount,
                totalInputColorCount: notice.totalInputColorCount,
              });
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
        case PaletteNoticeKind.ReducedUniqueColors:
          return "error";
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
