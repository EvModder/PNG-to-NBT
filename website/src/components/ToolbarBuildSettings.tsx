/**
 * Public API:
 * - ToolbarBuildSettingsProps
 * - ToolbarBuildSettings()
 *
 * Callers:
 * - src/components/ToolbarPresetSettings.tsx
 */
import { Fragment, type ReactNode } from "react";
import { Droplets, ArrowDownToLine, Printer, Pickaxe, Recycle } from "lucide-react";
import { Shade } from "@/data/mapColors";
import { messages } from "@/lib/messages";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import {
  buildModeUsesLayerGap,
  cycleSuppressStepDirection,
  isSuppressStepsBuildMode,
} from "@/utils/conversion";
import { INPUT_SQUARE_ICON_BUTTON_CLASS, ACCENT_SMALL_LABEL_TEXT_CLASS } from "@/data/uiClasses";

type WaterDropShade = Shade.Dark | Shade.Flat | Shade.Light;

type VisibleWaterLevelControl = {
  shade: WaterDropShade;
  value: number;
};

type ToolbarBuildModeOption = {
  value: BuildMode;
  label: string;
  disabled?: boolean;
  muted?: boolean;
};

// Callers:
// - src/components/ToolbarPresetSettings.tsx
export type ToolbarBuildSettingsProps = {
  lockFlatBuildMode: boolean;
  visibleWaterLevelControls: VisibleWaterLevelControl[];
  waterDropControlsDisabled: boolean;
  setNormalizedWaterDrop: (shade: WaterDropShade, value: number) => void;
  minLayerGap: number;
  layerGap: number;
  layerGapDisabled: boolean;
  setLayerGap: (value: number) => void;
  showCrubTechControl: boolean;
  crubTech: boolean;
  setCrubTech: (value: boolean) => void;
  showLatePairsGapControl: boolean;
  latePairsGap: number;
  maxLatePairsGap: number;
  latePairsGapDisabled: boolean;
  setLatePairsGap: (value: number) => void;
  showMixStepsToggle: boolean;
  mixSteps: boolean;
  setMixSteps: (value: boolean) => void;
  keepSuppressExtras: boolean;
  setKeepSuppressExtras: (value: boolean) => void;
  showSuppressCenterOutToggle: boolean;
  suppressCenterOut: boolean;
  setSuppressCenterOut: (value: boolean) => void;
  showPaletteSeedToggle: boolean;
  proPaletteSeed: boolean;
  setProPaletteSeed: (value: boolean) => void;
  showBuildAtWorldMinYToggle: boolean;
  buildAtWorldMinY: boolean;
  setBuildAtWorldMinY: (value: boolean) => void;
  buildMode: BuildMode;
  setBuildMode: (value: BuildMode) => void;
  showSuppressDirectionControl: boolean;
  suppressDirection: SuppressStepDirection;
  setSuppressDirection: (value: SuppressStepDirection) => void;
  isSuppressDirectionSelectable: (direction: SuppressStepDirection, centerOut?: boolean) => boolean;
  staircaseModeOptions: ToolbarBuildModeOption[];
  suppressModeOptions: ToolbarBuildModeOption[];
  shadingMethodTooltip: string;
};

function getSuppressStepDirectionRotationDegrees(direction: SuppressStepDirection): number {
  switch (direction) {
    case SuppressStepDirection.SouthToNorth:
      return 0;
    case SuppressStepDirection.WestToEast:
      return 90;
    case SuppressStepDirection.NorthToSouth:
      return 180;
    case SuppressStepDirection.EastToWest:
      return 270;
  }
}

function SuppressStepDirectionIcon({ direction, rotate, centerOut, isDirectionSelectable }: {
  direction: SuppressStepDirection;
  rotate: boolean;
  centerOut: boolean;
  isDirectionSelectable: (direction: SuppressStepDirection) => boolean;
}) {
  const rotation = getSuppressStepDirectionRotationDegrees(direction);
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <g
        className="fill-current"
        style={{
          color: "hsl(var(--accent))",
          fontFamily: "'JetBrains Mono', monospace",
          paintOrder: "stroke fill",
          stroke: "hsl(var(--input))",
          strokeWidth: 1.25,
        }}
      >
        <text x="12" y="3.3" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900" className={isDirectionSelectable(SuppressStepDirection.SouthToNorth) ? undefined : "text-muted-foreground"}>N</text>
        <text x="21.0" y="12" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900">E</text>
        <text x="12" y="21.8" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900" className={isDirectionSelectable(SuppressStepDirection.NorthToSouth) ? undefined : "text-muted-foreground"}>S</text>
        <text x="3.0" y="12" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900">W</text>
      </g>
      {rotate && !centerOut ? <path
        d="M12 11.9C12.1 11.6 12.3 11.3 12.7 11.1C13.2 10.9 13.9 11 14.4 11.5C15 12.1 15.2 13.2 14.6 14.2C14 15.1 12.7 15.8 11.3 15.4C10 15.1 8.9 13.7 8.9 12.2V7.5 M7.2 9.2l1.7-1.7 1.7 1.7"
        transform={`rotate(${rotation} 12 12)`}
        className="stroke-current fill-none"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      /> : <g transform={`rotate(${rotation} 12 12)`} className="stroke-current fill-none">
        <path d={centerOut ? "M12 16.2 L12 7.8" : "M12 16.6 L12 9.6"} strokeWidth="2.1" strokeLinecap="round" />
        <path d="M12 7.8 L9.8 10.2" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M12 7.8 L14.2 10.2" strokeWidth="2.1" strokeLinecap="round" />
        {centerOut && <path d="M9.8 13.8 L12 16.2 L14.2 13.8" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />}
      </g>}
    </svg>
  );
}

// Callers:
// - src/components/ToolbarPresetSettings.tsx
export function ToolbarBuildSettings({
  lockFlatBuildMode,
  visibleWaterLevelControls,
  waterDropControlsDisabled,
  setNormalizedWaterDrop,
  minLayerGap,
  layerGap,
  layerGapDisabled,
  setLayerGap,
  showCrubTechControl,
  crubTech,
  setCrubTech,
  showLatePairsGapControl,
  latePairsGap,
  maxLatePairsGap,
  latePairsGapDisabled,
  setLatePairsGap,
  showMixStepsToggle,
  mixSteps,
  setMixSteps,
  keepSuppressExtras,
  setKeepSuppressExtras,
  showSuppressCenterOutToggle,
  suppressCenterOut,
  setSuppressCenterOut,
  showPaletteSeedToggle,
  proPaletteSeed,
  setProPaletteSeed,
  showBuildAtWorldMinYToggle,
  buildAtWorldMinY,
  setBuildAtWorldMinY,
  buildMode,
  setBuildMode,
  showSuppressDirectionControl,
  suppressDirection,
  setSuppressDirection,
  isSuppressDirectionSelectable,
  staircaseModeOptions,
  suppressModeOptions,
  shadingMethodTooltip,
}: ToolbarBuildSettingsProps) {
  const showAnyWaterDropControl = visibleWaterLevelControls.length > 0;
  const showLayerGapControl = !lockFlatBuildMode && buildModeUsesLayerGap(buildMode);
  const crubTechActive = showCrubTechControl && crubTech;
  const centerOutDisabled = crubTechActive || (!suppressCenterOut && !isSuppressDirectionSelectable(suppressDirection, true));
  const nextSuppressDirection = cycleSuppressStepDirection(suppressDirection, direction => isSuppressDirectionSelectable(direction) && (
    !suppressCenterOut || getSuppressStepDirectionRotationDegrees(direction) % 180 !== getSuppressStepDirectionRotationDegrees(suppressDirection) % 180
  ));
  const directionDisabled = nextSuppressDirection === suppressDirection || crubTechActive;
  const showMixStepsControl = !lockFlatBuildMode && showMixStepsToggle;
  const showCenterOutControl = !lockFlatBuildMode && showSuppressCenterOutToggle;
  const showPaletteSeedControl = !lockFlatBuildMode && showPaletteSeedToggle;
  const showBuildModeControl = !lockFlatBuildMode;
  const groups: { key: string; node: ReactNode }[] = [];

  if (showAnyWaterDropControl) {
    groups.push({
      key: "water-levels",
      node: (
        <>
          {visibleWaterLevelControls.map(({ shade, value }) => {
            const tooltip = messages.buildMode.waterLevelTooltip(shade);
            const ariaLabel = messages.buildMode.waterLevelAriaLabel(shade);
            return (
              <label
                key={shade}
                className={`inline-flex items-center gap-1 cursor-help ${waterDropControlsDisabled ? "opacity-55" : ""}`}
                title={tooltip}
              >
                <span
                  aria-hidden="true"
                  className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} inline-flex items-center gap-0.5`}
                >
                  <Droplets className="h-3 w-3" />
                  <span>{shade}</span>
                  <span className="inline-flex items-center"><ArrowDownToLine className="h-3 w-3 -mr-px" />:</span>
                </span>
                <span className="sr-only">{ariaLabel}</span>
                <input
                  type="number"
                  min={0}
                  value={value}
                  disabled={waterDropControlsDisabled}
                  onChange={e => setNormalizedWaterDrop(shade, parseInt(e.target.value) || 0)}
                  title={tooltip}
                  aria-label={ariaLabel}
                  className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs w-12 text-center disabled:cursor-not-allowed"
                />
              </label>
            );
          })}
        </>
      ),
    });
  }

  if (showLayerGapControl && showLatePairsGapControl) {
    groups.push({
      key: "late-pairs-gap",
      node: (
        <>
          <span
            className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} cursor-help ${latePairsGapDisabled ? "opacity-55" : ""}`}
            title={messages.buildMode.latePairsGapTooltip}
          >
            {messages.buildMode.latePairsGapLabel}
          </span>
          <input
            type="number"
            min={1}
            max={maxLatePairsGap}
            value={Math.max(1, Math.min(maxLatePairsGap, latePairsGap))}
            disabled={latePairsGapDisabled}
            onChange={e => setLatePairsGap(Math.max(1, Math.min(maxLatePairsGap, parseInt(e.target.value) || 1)))}
            title={messages.buildMode.latePairsGapTooltip}
            className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs w-12 text-center disabled:opacity-55 disabled:cursor-not-allowed"
          />
        </>
      ),
    });
  }

  if (showLayerGapControl) {
    groups.push({
      key: "layer-gap",
      node: (
        <>
          <span
            className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} cursor-help ${layerGapDisabled ? "opacity-55" : ""}`}
            title={messages.buildMode.layerGapTooltip}
          >
            {messages.buildMode.layerGapLabel}
          </span>
          <input
            type="number"
            min={minLayerGap}
            max={20}
            value={layerGap}
            disabled={layerGapDisabled}
            onChange={e => setLayerGap(Math.max(minLayerGap, Math.min(20, parseInt(e.target.value) || 5)))}
            title={messages.buildMode.layerGapTooltip}
            className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs w-12 text-center disabled:opacity-55 disabled:cursor-not-allowed"
          />
        </>
      ),
    });
  }

  if (showLayerGapControl && showCrubTechControl) {
    groups.push({
      key: "crubtech",
      node: (
        <label
          className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} flex items-center gap-1 cursor-pointer`}
          title={messages.buildMode.crubTechTooltip}
        >
          <span>{messages.buildMode.crubTechLabel}</span>
          <input
            type="checkbox"
            checked={crubTech}
            onChange={e => setCrubTech(e.target.checked)}
            title={messages.buildMode.crubTechTooltip}
            className="h-3.5 w-3.5"
          />
        </label>
      ),
    });
  }

  if (showMixStepsControl) {
    groups.push({
      key: "mix-steps",
      node: (
        <label
          className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} flex items-center gap-1 cursor-pointer`}
          title={messages.buildMode.mixStepsTooltip}
        >
          <span aria-hidden="true" className="inline-flex items-center">
            <span className="inline-flex items-center gap-px">
              <Printer className="h-4 w-4" />
              <span className="-mr-px">+</span>
              <Pickaxe className="h-4 w-4 mr-[0.25px]" />
            </span>
            <span>:</span>
          </span>
          <span className="sr-only">{messages.buildMode.mixStepsLabel}</span>
          <input
            type="checkbox"
            checked={mixSteps}
            onChange={e => setMixSteps(e.target.checked)}
            title={messages.buildMode.mixStepsTooltip}
            className="h-3.5 w-3.5"
          />
        </label>
      ),
    });
  }

  if (!lockFlatBuildMode && isSuppressStepsBuildMode(buildMode)) {
    groups.push({
      key: "keep-extras",
      node: (
        <label
          className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} flex items-center gap-1 cursor-pointer`}
          title={messages.buildMode.keepSuppressExtrasTooltip}
        >
          <span aria-hidden="true" className="inline-flex items-center">
            <Recycle className="h-4 w-4 -mr-[0.5px]" />
            <span>:</span>
          </span>
          <span className="sr-only">{messages.buildMode.keepSuppressExtrasLabel}</span>
          <input
            type="checkbox"
            checked={!keepSuppressExtras}
            onChange={e => setKeepSuppressExtras(!e.target.checked)}
            className="h-3.5 w-3.5"
          />
        </label>
      ),
    });
  }

  if (showPaletteSeedControl) {
    groups.push({
      key: "palette-seed",
      node: (
        <label className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} flex items-center gap-1 cursor-pointer`}>
          <span>{messages.buildMode.paletteSeedLabel}</span>
          <input
            type="checkbox"
            checked={proPaletteSeed}
            onChange={e => setProPaletteSeed(e.target.checked)}
            className="h-3.5 w-3.5"
          />
        </label>
      ),
    });
  }

  if (showBuildAtWorldMinYToggle) {
    groups.push({
      key: "build-at-world-min-y",
      node: (
        <label
          className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} flex items-center gap-1 cursor-pointer`}
          title={messages.buildMode.buildAtWorldMinYTooltip}
        >
          <span>{messages.buildMode.buildAtWorldMinYLabel}</span>
          <input
            type="checkbox"
            checked={buildAtWorldMinY}
            onChange={e => setBuildAtWorldMinY(e.target.checked)}
            title={messages.buildMode.buildAtWorldMinYTooltip}
            className="h-3.5 w-3.5"
          />
        </label>
      ),
    });
  }

  if (showCenterOutControl || showSuppressDirectionControl) {
    groups.push({
      key: "direction",
      node: (
        <>
          {showCenterOutControl && <button
            type="button"
            className={`${INPUT_SQUARE_ICON_BUTTON_CLASS} disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:border-border`}
            title={messages.buildMode.centerOutTooltip}
            aria-label={messages.buildMode.centerOutLabel}
            aria-pressed={suppressCenterOut}
            disabled={centerOutDisabled}
            onClick={() => setSuppressCenterOut(!suppressCenterOut)}
          >
            <svg
              viewBox="0 0 20 20"
              className="h-5 w-5 fill-current"
              aria-hidden="true"
            >
              <g transform={`rotate(${getSuppressStepDirectionRotationDegrees(suppressDirection) + 90} 10 10)`}>
                <path d={`M${suppressCenterOut ? 10 : 18} .5v19`} className="text-accent stroke-current fill-none" strokeWidth="2" strokeDasharray="1 1" />
                <path d={suppressCenterOut ? "M0 10 4 6v3h4v2H4v3z" : "M0 10 4 6v3h11v2H4v3z"} />
                {suppressCenterOut && <path d="M20 10 16 6v3h-4v2h4v3z" />}
              </g>
            </svg>
          </button>}
          {showSuppressDirectionControl && <button
            type="button"
            className={`${INPUT_SQUARE_ICON_BUTTON_CLASS} disabled:opacity-55 disabled:cursor-not-allowed disabled:hover:border-border`}
            disabled={directionDisabled}
            title={directionDisabled
              ? `${messages.buildMode.stepDirectionAriaLabel(suppressDirection, suppressCenterOut)}. ${crubTechActive ? messages.buildMode.crubTechTooltip : messages.buildMode.centerOutTooltip}`
              : `${messages.buildMode.stepDirectionTooltip(suppressDirection, suppressCenterOut)}${showLayerGapControl ? ` ${messages.buildMode.twoLayerDirectionTooltip(suppressDirection, suppressCenterOut)}` : ""}`}
            aria-label={messages.buildMode.stepDirectionAriaLabel(suppressDirection, suppressCenterOut)}
            onClick={() => setSuppressDirection(nextSuppressDirection)}
          >
            <SuppressStepDirectionIcon
              direction={suppressDirection}
              rotate={showCenterOutControl}
              centerOut={showCenterOutControl && suppressCenterOut}
              isDirectionSelectable={isSuppressDirectionSelectable}
            />
          </button>}
        </>
      ),
    });
  }

  if (showBuildModeControl) {
    groups.push({
      key: "build-mode",
      node: (
        <>
          <span className={ACCENT_SMALL_LABEL_TEXT_CLASS}>
            {messages.buildMode.label}
          </span>
          <select
            className={`base-select-picker bg-input border border-border rounded px-2 h-6 text-xs cursor-help ${
              buildMode === BuildMode.SuppressSplitRow ? "text-muted-foreground" : "text-foreground"
            }`}
            value={buildMode}
            onChange={e => setBuildMode(e.target.value as BuildMode)}
            title={shadingMethodTooltip}
          >
            <optgroup label={messages.buildMode.staircaseGroupLabel}>
              {staircaseModeOptions.map(opt => (
                <option key={opt.value} value={opt.value} title={messages.buildMode.tooltip(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </optgroup>
            <optgroup label={messages.buildMode.suppressGroupLabel}>
              {suppressModeOptions.map(opt => (
                <option
                  key={opt.value}
                  value={opt.value}
                  disabled={opt.disabled}
                  data-muted={opt.muted ? "true" : undefined}
                  style={opt.muted ? { fontStyle: "italic" } : undefined}
                  title={messages.buildMode.tooltip(opt.value)}
                >
                  {opt.label}
                </option>
              ))}
            </optgroup>
          </select>
        </>
      ),
    });
  }

  if (!groups.length) return null;

  return (
    <div className="ml-auto flex items-center gap-1">
      {groups.map((group, index) => (
        <Fragment key={group.key}>
          {index > 0 && <span aria-hidden="true" className="vertical-separator mx-0.5" />}
          {group.node}
        </Fragment>
      ))}
    </div>
  );
}
