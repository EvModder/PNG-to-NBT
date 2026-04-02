/**
 * Public API:
 * - PanelImagePreview()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { MutableRefObject, RefObject } from "react";
import { PaletteNoticeKind, messages, type PaletteNotice } from "@/lib/messages";
import { BuildMode } from "@/types/conversion";

type PreviewWarning = {
  text: string;
  invalid: boolean;
};

type PanelImagePreviewProps = {
  fileRef: RefObject<HTMLInputElement | null>;
  imageData: ImageData | null;
  previewImageUrl: string | null;
  imageName: string;
  handleFile: (file: File) => void;
  canCopyImageShareUrl: boolean;
  copyImageShareUrl: () => Promise<void>;
  showVsFillersInPreviewToggle: boolean;
  showVsFillersInPreview: boolean;
  setShowVsFillersInPreview: (value: boolean) => void;
  paletteNotices: PaletteNotice[];
  imageValid: boolean;
  missingBlocks: number[];
  noFillerWarning: string | null;
  suppressStepNorthSouthWarning: string | null;
  waterSideSupportWarning: PreviewWarning | null;
  fragileSupportOverrideWarning: PreviewWarning | null;
  vsFillerWarning: PreviewWarning | null;
  lateFillerWarning: PreviewWarning | null;
  showNorthRowAlignmentInfo: boolean;
  canGenerate: boolean;
  imageHasWater: boolean;
  usesIceForWater: boolean;
  clearImage: () => void;
  handleConvertAndDownload: () => void;
  converting: boolean;
  buildMode: BuildMode;
  showUsageInfo: boolean;
  numUniqueColorShadesForPart: number;
  numColorBlockTypesForPart: number;
  vsFillerSpotCount: number;
  colRangeEnabled: boolean;
  setColRangeEnabled: (value: boolean | ((value: boolean) => boolean)) => void;
  isStepRangeMode: boolean;
  colStart: number;
  colEnd: number;
  maxRangeIndex: number;
  colStartRef: MutableRefObject<number>;
  colEndRef: MutableRefObject<number>;
  setColStart: (value: number) => void;
  setColEnd: (value: number) => void;
};

function WarningBanner({
  text,
  tone,
  invalid = false,
}: {
  text: string;
  tone: "error" | "warning" | "muted";
  invalid?: boolean;
}) {
  const className =
    tone === "error"
      ? "mt-2 bg-destructive/25 border-2 border-destructive/50 rounded p-2"
      : tone === "warning"
        ? "mt-2 bg-warning/20 border-2 border-warning/40 rounded p-2"
        : "mt-2 bg-muted/30 border border-border rounded p-2";
  const textClassName =
    tone === "muted"
      ? "text-xs text-muted-foreground font-medium whitespace-pre-line"
      : tone === "error"
        ? `text-xs whitespace-pre-line ${invalid ? "text-destructive font-bold" : "text-destructive font-medium"}`
        : `text-xs whitespace-pre-line ${invalid ? "text-destructive font-bold" : "text-warning font-medium"}`;

  return (
    <div className={className}>
      <p className={textClassName}>{text}</p>
    </div>
  );
}

// Callers:
// - src/Index.tsx
export function PanelImagePreview({
  fileRef,
  imageData,
  previewImageUrl,
  imageName,
  handleFile,
  canCopyImageShareUrl,
  copyImageShareUrl,
  showVsFillersInPreviewToggle,
  showVsFillersInPreview,
  setShowVsFillersInPreview,
  paletteNotices,
  imageValid,
  missingBlocks,
  noFillerWarning,
  suppressStepNorthSouthWarning,
  waterSideSupportWarning,
  fragileSupportOverrideWarning,
  vsFillerWarning,
  lateFillerWarning,
  showNorthRowAlignmentInfo,
  canGenerate,
  imageHasWater,
  usesIceForWater,
  clearImage,
  handleConvertAndDownload,
  converting,
  buildMode,
  showUsageInfo,
  numUniqueColorShadesForPart,
  numColorBlockTypesForPart,
  vsFillerSpotCount,
  colRangeEnabled,
  setColRangeEnabled,
  isStepRangeMode,
  colStart,
  colEnd,
  maxRangeIndex,
  colStartRef,
  colEndRef,
  setColStart,
  setColEnd,
}: PanelImagePreviewProps) {
  return (
    <section className="bg-card border border-border rounded-md p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        {canCopyImageShareUrl ? (
          <button
            type="button"
            className="bg-transparent p-0 border-0 text-sm font-semibold text-accent text-left hover:underline decoration-dotted underline-offset-2"
            onClick={() => { void copyImageShareUrl(); }}
            title={messages.upload.copyImageUrlTitle}
          >
            {messages.upload.title}
          </button>
        ) : (
          <h2 className="text-sm font-semibold text-accent">{messages.upload.title}</h2>
        )}
        {showVsFillersInPreviewToggle && (
          <label
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none"
            title={messages.upload.showVsFillersTooltip}
          >
            <input
              type="checkbox"
              checked={showVsFillersInPreview}
              onChange={e => setShowVsFillersInPreview(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            <span>{messages.upload.showVsFillersToggle}</span>
          </label>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {imageName && <p className="text-xs text-primary font-mono truncate mb-1">{imageName}</p>}
      <div className="w-full max-w-[516px] mx-auto">
        <div
          className="rounded-md w-full aspect-square cursor-pointer border-2 border-dashed border-border hover:border-primary/50 transition-colors overflow-hidden flex items-center justify-center"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          {imageData && previewImageUrl ? (
            <img
              src={previewImageUrl}
              alt={imageName || messages.upload.title}
              className="w-full h-full"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center px-2">{messages.upload.placeholder}</p>
          )}
        </div>
      </div>

      {paletteNotices.length > 0 && (
        <div
          className={`mt-2 rounded p-2 ${
            messages.parsing.bannerTone(paletteNotices) === "error"
              ? "bg-destructive/25 border-2 border-destructive/50"
              : messages.parsing.bannerTone(paletteNotices) === "warning"
                ? "bg-warning/20 border-2 border-warning/40"
                : "bg-primary/10 border-2 border-primary/30"
          }`}
        >
          {paletteNotices.map((notice, index) => (
            <p
              key={index}
              className={`text-xs whitespace-pre-wrap ${
                messages.parsing.noticeTone(notice) === "error"
                  ? notice.kind === PaletteNoticeKind.ReducedUniqueColors
                    ? "text-destructive font-bold"
                    : "text-destructive font-medium"
                  : messages.parsing.noticeTone(notice) === "warning"
                    ? "text-warning font-medium"
                    : "text-primary font-medium"
              }`}
            >
              {messages.parsing.noticeText(notice)}
            </p>
          ))}
        </div>
      )}

      {imageValid && missingBlocks.length > 0 && (
        <WarningBanner
          text={messages.preview.missingBlockAssignments(missingBlocks.length)}
          tone="error"
        />
      )}
      {noFillerWarning && <WarningBanner text={noFillerWarning} tone="warning" />}
      {suppressStepNorthSouthWarning && <WarningBanner text={suppressStepNorthSouthWarning} tone="warning" />}
      {waterSideSupportWarning && <WarningBanner text={waterSideSupportWarning.text} tone="warning" invalid={waterSideSupportWarning.invalid} />}
      {fragileSupportOverrideWarning && <WarningBanner text={fragileSupportOverrideWarning.text} tone="warning" invalid={fragileSupportOverrideWarning.invalid} />}
      {vsFillerWarning && <WarningBanner text={vsFillerWarning.text} tone="warning" invalid={vsFillerWarning.invalid} />}
      {lateFillerWarning && <WarningBanner text={lateFillerWarning.text} tone="warning" invalid={lateFillerWarning.invalid} />}
      {showNorthRowAlignmentInfo && <WarningBanner text={messages.preview.northRowAlignmentInfo} tone="muted" />}
      {canGenerate && imageHasWater && usesIceForWater && <WarningBanner text={messages.preview.iceConversionInfo} tone="muted" />}

      {imageData && (
        <div className="mt-2 flex items-center gap-2">
          <button
            className="text-xs px-2 py-1.5 rounded border border-destructive text-destructive hover:bg-destructive/20 whitespace-nowrap"
            onClick={clearImage}
          >
            {messages.common.remove}
          </button>
          {canGenerate && (
            <button
              onClick={handleConvertAndDownload}
              disabled={converting}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {converting
                ? messages.upload.convertButton(true, false)
                : messages.upload.convertButton(
                    false,
                    buildMode === BuildMode.SuppressSplitRow || buildMode === BuildMode.SuppressSplitChecker,
                  )}
            </button>
          )}
        </div>
      )}

      {showUsageInfo && (
        <div className="mt-2 space-y-1">
          <div className="flex gap-3 text-[11px] text-muted-foreground flex-wrap items-center">
            {numUniqueColorShadesForPart > numColorBlockTypesForPart && (
              <span>
                <strong className="text-foreground">{messages.preview.uniqueColorCount(numUniqueColorShadesForPart)}</strong>
              </span>
            )}
            <span>
              <strong className="text-foreground">{messages.preview.blockTypeCount(numColorBlockTypesForPart)}</strong>
            </span>
            {vsFillerSpotCount > 0 && (
              <span>
                <strong className="text-foreground">{messages.preview.voidShadowCount(vsFillerSpotCount)}</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <button
              className={`text-[10px] px-1.5 py-0.5 rounded border ${colRangeEnabled ? "border-primary bg-primary/15 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"}`}
              onClick={() => setColRangeEnabled(value => !value)}
            >
              {messages.preview.rangeButtonLabel(isStepRangeMode)}
            </button>
          </div>
          {colRangeEnabled && (
            <div className="mt-1 border border-border rounded p-1.5 bg-muted/30">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-foreground w-6 text-right">{colStart}</span>
                <div
                  className="relative flex-1 h-4 select-none touch-none"
                  onPointerDown={e => {
                    const element = e.currentTarget;
                    element.setPointerCapture(e.pointerId);
                    const rect = element.getBoundingClientRect();
                    const valFromEvent = (event: PointerEvent) => {
                      const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                      return Math.round(pct * maxRangeIndex);
                    };
                    const value = valFromEvent(e.nativeEvent);
                    const grabStart =
                      colStartRef.current === colEndRef.current
                        ? colStartRef.current >= maxRangeIndex
                        : Math.abs(value - colStartRef.current) <= Math.abs(value - colEndRef.current);
                    const update = (next: number) => {
                      if (grabStart) setColStart(Math.min(next, colEndRef.current));
                      else setColEnd(Math.max(next, colStartRef.current));
                    };
                    update(value);
                    const onMove = (event: PointerEvent) => update(valFromEvent(event));
                    const onUp = () => {
                      element.removeEventListener("pointermove", onMove);
                      element.removeEventListener("pointerup", onUp);
                    };
                    element.addEventListener("pointermove", onMove);
                    element.addEventListener("pointerup", onUp);
                  }}
                >
                  <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1 rounded bg-border" />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-1 rounded bg-primary"
                    style={{
                      left: `${maxRangeIndex > 0 ? (colStart / maxRangeIndex) * 100 : 0}%`,
                      right: `${100 - (maxRangeIndex > 0 ? (colEnd / maxRangeIndex) * 100 : 0)}%`,
                    }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground -ml-1.5"
                    style={{ left: `${maxRangeIndex > 0 ? (colStart / maxRangeIndex) * 100 : 0}%` }}
                  />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground -ml-1.5"
                    style={{ left: `${maxRangeIndex > 0 ? (colEnd / maxRangeIndex) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-foreground w-6">{colEnd}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
