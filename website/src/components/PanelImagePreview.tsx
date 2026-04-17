/**
 * Public API:
 * - PanelImagePreview()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { MutableRefObject, RefObject } from "react";
import { PaletteNoticeKind, messages, type PaletteNotice } from "@/lib/messages";
import { MUTED_INLINE_TOGGLE_CONTROL_CLASS, PANEL_TITLE_TEXT_CLASS } from "@/utils/uiTypography";

type PreviewWarning = {
  text: string;
  invalid: boolean;
};

type PaletteNoticeGroup = {
  notices: PaletteNotice[];
  containerTone: "info" | "warning" | "error";
};

type PanelImagePreviewProps = {
  fileRef: RefObject<HTMLInputElement | null>;
  imageData: ImageData | null;
  previewImageUrl: string | null;
  fallbackPreviewImageUrl: string | null;
  imageName: string;
  handleFile: (file: File) => void;
  canCopyImageShareUrl: boolean;
  copyImageShareUrl: () => Promise<void>;
  showVsFillersInPreviewToggle: boolean;
  showVsFillersInPreview: boolean;
  setShowVsFillersInPreview: (value: boolean) => void;
  paletteNotices: PaletteNotice[];
  imageValid: boolean;
  missingBlockCount: number;
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
  generateButtonLabel: string;
  busy: boolean;
  busyText: string | null;
  showUsageInfo: boolean;
  numUniqueColorShadesForPart: number;
  numColorBlockTypesForPart: number;
  vsFillerSpotCount: number;
  showRangeControls: boolean;
  showTileSelection: boolean;
  tileRows: number;
  tileCols: number;
  selectedTileIndices: ReadonlySet<number>;
  onTileSelection: (tileIndex: number, modifiers: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) => void;
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

function getPaletteNoticeGroupContainerTone(notices: readonly PaletteNotice[]): "info" | "warning" | "error" {
  if (notices[0]?.kind === PaletteNoticeKind.CroppedImage) return "warning";
  return messages.parsing.bannerTone([...notices]);
}

function groupPaletteNotices(paletteNotices: readonly PaletteNotice[]): PaletteNoticeGroup[] {
  const groups: PaletteNoticeGroup[] = [];
  let currentNonCropGroup: PaletteNotice[] = [];

  const flushCurrentNonCropGroup = () => {
    if (currentNonCropGroup.length === 0) return;
    groups.push({
      notices: currentNonCropGroup,
      containerTone: getPaletteNoticeGroupContainerTone(currentNonCropGroup),
    });
    currentNonCropGroup = [];
  };

  for (let index = 0; index < paletteNotices.length; ++index) {
    const notice = paletteNotices[index];
    if (
      notice?.kind === PaletteNoticeKind.CroppedImage &&
      paletteNotices[index + 1]?.kind === PaletteNoticeKind.CroppedImageRemovedPixels
    ) {
      flushCurrentNonCropGroup();
      const notices = [notice, paletteNotices[index + 1]];
      groups.push({
        notices,
        containerTone: getPaletteNoticeGroupContainerTone(notices),
      });
      ++index;
      continue;
    }

    currentNonCropGroup.push(notice);
  }

  flushCurrentNonCropGroup();
  return groups;
}

// Callers:
// - src/Index.tsx
export function PanelImagePreview({
  fileRef,
  imageData,
  previewImageUrl,
  fallbackPreviewImageUrl,
  imageName,
  handleFile,
  canCopyImageShareUrl,
  copyImageShareUrl,
  showVsFillersInPreviewToggle,
  showVsFillersInPreview,
  setShowVsFillersInPreview,
  paletteNotices,
  imageValid,
  missingBlockCount,
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
  generateButtonLabel,
  busy,
  busyText,
  showUsageInfo,
  numUniqueColorShadesForPart,
  numColorBlockTypesForPart,
  vsFillerSpotCount,
  showRangeControls,
  showTileSelection,
  tileRows,
  tileCols,
  selectedTileIndices,
  onTileSelection,
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
  const previewAspectRatio = imageData ? `${imageData.width} / ${imageData.height}` : "1 / 1";
  const activePreviewImageUrl = previewImageUrl ?? fallbackPreviewImageUrl;
  const paletteNoticeGroups = groupPaletteNotices(paletteNotices);

  return (
    <section className="bg-card border border-border rounded-md px-3 pb-3 pt-3">
      <div className="mb-1 flex min-h-3.5 items-center justify-between gap-2">
        {canCopyImageShareUrl ? (
          <button
            type="button"
            className={`bg-transparent p-0 border-0 ${PANEL_TITLE_TEXT_CLASS} text-left hover:underline decoration-dotted underline-offset-2`}
            onClick={() => { void copyImageShareUrl(); }}
            title={messages.upload.copyImageUrlTitle}
          >
            {messages.upload.title}
          </button>
        ) : (
          <h2 className={PANEL_TITLE_TEXT_CLASS}>{messages.upload.title}</h2>
        )}
        {showVsFillersInPreviewToggle && (
          <label
            className={MUTED_INLINE_TOGGLE_CONTROL_CLASS}
            title={messages.upload.showVsFillersTooltip}
          >
            <span>{messages.upload.showVsFillersToggle}</span>
            <input
              type="checkbox"
              checked={showVsFillersInPreview}
              onChange={e => setShowVsFillersInPreview(e.target.checked)}
              className="h-3.5 w-3.5"
            />
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
      <p
        className={`flex items-center text-[11px] leading-none text-primary font-mono truncate mb-1 min-h-[0.75rem] ${
          imageName ? "" : "invisible"
        }`}
        aria-hidden={imageName ? undefined : true}
      >
        {imageName || "\u00A0"}
      </p>
      <div className="w-full mx-auto">
        <div
          className={`relative rounded-md w-full border-2 border-dashed border-border transition-colors overflow-hidden flex items-center justify-center ${
            showTileSelection ? "" : "cursor-pointer hover:border-primary/50"
          }`}
          style={{ aspectRatio: previewAspectRatio }}
          onClick={() => {
            if (!showTileSelection) fileRef.current?.click();
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
        >
          {imageData && activePreviewImageUrl ? (
            <>
              <img
                src={activePreviewImageUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full"
                style={{ imageRendering: "pixelated" }}
              />
              {busy && busyText && (
                <div className="absolute inset-0 bg-card/35 backdrop-blur-[1px] pointer-events-none flex items-center justify-center">
                  <div className="inline-flex items-center gap-2 rounded-md border border-border/80 bg-card/90 px-3 py-1.5 text-[11px] text-foreground shadow-sm">
                    <span className="h-3.5 w-3.5 rounded-full border border-primary/25 border-t-primary animate-spin" />
                    {busyText}
                  </div>
                </div>
              )}
              {showTileSelection && tileRows > 0 && tileCols > 0 && (
                <div
                  className="absolute inset-0 grid"
                  style={{
                    gridTemplateColumns: `repeat(${tileCols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${tileRows}, minmax(0, 1fr))`,
                  }}
                >
                  {Array.from({ length: tileRows * tileCols }, (_, index) => (
                    <button
                      key={index}
                      type="button"
                      className={`border border-black/15 transition-colors ${
                        selectedTileIndices.has(index)
                          ? "bg-primary/10 shadow-[inset_0_0_0_2px_hsl(var(--primary))]"
                          : "hover:bg-primary/5"
                      }`}
                      aria-label={`Tile ${index + 1}`}
                      aria-pressed={selectedTileIndices.has(index)}
                      onClick={e => {
                        e.stopPropagation();
                        onTileSelection(index, {
                          shiftKey: e.shiftKey,
                          metaKey: e.metaKey,
                          ctrlKey: e.ctrlKey,
                        });
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-3 text-center">
              {busy && busyText ? (
                <>
                  <span className="h-4 w-4 rounded-full border border-primary/25 border-t-primary animate-spin" />
                  <p className="text-xs text-muted-foreground">{busyText}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{messages.upload.placeholder}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {paletteNoticeGroups.map((group, groupIndex) => (
        <div
          key={groupIndex}
          className={`mt-2 rounded p-2 ${
            group.containerTone === "error"
              ? "bg-destructive/25 border-2 border-destructive/50"
              : group.containerTone === "warning"
                ? "bg-warning/20 border-2 border-warning/40"
                : "bg-primary/10 border-2 border-primary/30"
          }`}
        >
          {group.notices.map((notice, noticeIndex) => (
            <p
              key={`${groupIndex}-${noticeIndex}`}
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
      ))}

      {imageValid && missingBlockCount > 0 && (
        <WarningBanner
          text={messages.preview.missingBlockAssignments(missingBlockCount)}
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
            {busy ? messages.upload.cancelButton : messages.upload.removeButton}
          </button>
          {canGenerate && (
            <button
              onClick={handleConvertAndDownload}
              disabled={converting || busy}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {converting ? messages.upload.convertButton(true, false) : generateButtonLabel}
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
          {showRangeControls && (
            <div className="flex items-center gap-1 mt-1">
              <button
                className={`text-[10px] px-1.5 py-0.5 rounded border ${colRangeEnabled ? "border-primary bg-primary/15 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground"}`}
                onClick={() => setColRangeEnabled(value => !value)}
              >
                {messages.preview.rangeButtonLabel(isStepRangeMode)}
              </button>
            </div>
          )}
          {showRangeControls && colRangeEnabled && (
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
