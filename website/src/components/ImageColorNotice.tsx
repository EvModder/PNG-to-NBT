/**
 * Public API:
 * - ImageColorNotice()
 * - isColorCorrectionNotice()
 *
 * Callers:
 * - src/components/PanelImagePreview.tsx
 */
import { Fragment } from "react";
import { INVALID_COLORS_PALETTE_OPTIONS, type InvalidColorsPalette } from "@/data/defaultSettings";
import { PaletteNoticeKind, messages, type PaletteNotice } from "@/lib/messages";
import type { InputPaletteEquivalence } from "@/lib/colorGridParsingCore";

export function isColorCorrectionNotice(notice: PaletteNotice): boolean {
  return notice.kind === PaletteNoticeKind.UnsupportedPaletteColors ||
    notice.kind === PaletteNoticeKind.ConvertedPaletteColors ||
    notice.kind === PaletteNoticeKind.ReducedUniqueColors ||
    notice.kind === PaletteNoticeKind.LossyFormatHint;
}

type ImageColorNoticeProps = {
  notices: readonly PaletteNotice[];
  missingBlockCount: number;
  currentPalette: InvalidColorsPalette | null;
  inputPaletteEquivalence: InputPaletteEquivalence;
  fullInputPalette: boolean;
  hasPresetColors: boolean;
  onResolve?: (palette: InvalidColorsPalette) => void;
};

export function ImageColorNotice({
  notices,
  missingBlockCount,
  currentPalette,
  inputPaletteEquivalence,
  fullInputPalette,
  hasPresetColors,
  onResolve,
}: ImageColorNoticeProps) {
  const unsupported = notices.find(notice => notice.kind === PaletteNoticeKind.UnsupportedPaletteColors);
  const converted = notices.find(notice => notice.kind === PaletteNoticeKind.ConvertedPaletteColors);
  const headline = unsupported ?? converted;
  if (!headline && missingBlockCount === 0) return null;

  const blocking = !!unsupported || missingBlockCount > 0;
  const { fullPreset, fullFlat, presetFlat } = inputPaletteEquivalence;
  const canonical = (palette: InvalidColorsPalette): InvalidColorsPalette => {
    if (!hasPresetColors) return palette;
    if (palette === "full") return fullFlat ? "current-flat" : "full";
    if (palette === "current") return presetFlat ? "current-flat" : fullPreset ? "full" : "current";
    return palette;
  };
  const activePalette = currentPalette ? canonical(currentPalette) : null;
  const flatLabel = fullInputPalette || (hasPresetColors && fullFlat);
  const palettes = [...new Set(INVALID_COLORS_PALETTE_OPTIONS
    .filter(palette => (palette === "full" || hasPresetColors) && (missingBlockCount === 0 || palette !== "full"))
    .map(canonical))];
  const singlePalette = palettes.length === 1;
  const options = palettes.filter(palette => !!unsupported || palette !== activePalette);
  const headlineText = headline
    ? headline.kind === PaletteNoticeKind.ConvertedPaletteColors && singlePalette
      ? messages.parsing.mappedToMapPalette(headline.convertedCount)
      : messages.parsing.noticeText(headline, currentPalette, flatLabel, activePalette)
    : messages.preview.missingBlockAssignments(missingBlockCount);
  const actions = onResolve && options.length > 0 && options.map((palette, index) => (
    <Fragment key={palette}>
      {index > 0 && " | "}
      <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onResolve(palette)}>
        {singlePalette ? messages.parsing.convertColors : messages.parsing.colorPaletteName(palette, flatLabel)}
      </button>
    </Fragment>
  ));

  return (
    <div className={`mt-2 rounded p-2 border-2 ${blocking
      ? "bg-destructive/25 border-destructive/50"
      : "bg-warning/20 border-warning/40"}`}>
      <p className={`text-xs font-medium whitespace-pre-wrap ${unsupported || !converted ? "text-destructive-text" : "text-warning-text"}`}>
        {headlineText.replace(/\.$/, "")}
        {!unsupported && actions && (
          <span className="text-warning-text"> ({actions})</span>
        )}
        .
      </p>
      {unsupported && actions && (
        <p className="text-xs text-warning-text font-medium">
          {!singlePalette && `${messages.parsing.convertColorsUsing} `}{actions}
        </p>
      )}
      {!unsupported && converted && notices.map((notice, index) =>
        notice.kind === PaletteNoticeKind.ReducedUniqueColors || notice.kind === PaletteNoticeKind.LossyFormatHint ? (
          <p key={index} className={`text-xs font-medium whitespace-pre-wrap ${notice.kind === PaletteNoticeKind.ReducedUniqueColors
            ? "text-destructive-text"
            : "text-warning-text"}`}>
            {messages.parsing.noticeText(notice)}
          </p>
        ) : null,
      )}
      {headline && missingBlockCount > 0 && (
        <p className="text-xs text-destructive-text font-medium">
          {messages.preview.missingBlockAssignments(missingBlockCount)}
        </p>
      )}
    </div>
  );
}
