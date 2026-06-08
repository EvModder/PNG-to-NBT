/**
 * Public API:
 * - ToolbarBuildSettingsProps
 * - ToolbarBuildSettings()
 *
 * Callers:
 * - src/components/ToolbarPresetSettings.tsx
 */
import { Fragment, type ReactNode } from "react";
import { Droplets, ArrowDownToLine } from "lucide-react";
import { Shade } from "@/data/mapColors";
import { messages } from "@/lib/messages";
import { BuildMode, SuppressStepDirection } from "@/types/conversion";
import {
  buildModeUsesLayerGap,
  cycleSuppressStepDirection,
  getSuppressStepDirectionRotationDegrees,
} from "@/utils/conversion";
import { INPUT_SQUARE_ICON_BUTTON_CLASS } from "@/utils/uiButtons";
import { ACCENT_SMALL_LABEL_TEXT_CLASS } from "@/utils/uiTypography";

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
  isSuppressDirectionSelectable: (direction: SuppressStepDirection) => boolean;
  staircaseModeOptions: ToolbarBuildModeOption[];
  suppressModeOptions: ToolbarBuildModeOption[];
  shadingMethodTooltip: string;
};

function SuppressStepDirectionIcon({ direction }: { direction: SuppressStepDirection }) {
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
        <text x="12" y="3.3" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900">N</text>
        <text x="21.0" y="12" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900">E</text>
        <text x="12" y="21.8" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900">S</text>
        <text x="3.0" y="12" textAnchor="middle" dominantBaseline="middle" fontSize="7.8" fontWeight="900">W</text>
      </g>
      <g transform={`rotate(${rotation} 12 12)`} className="stroke-current fill-none">
        <path d="M12 16.6 L12 9.6" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M12 7.8 L9.8 10.2" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M12 7.8 L14.2 10.2" strokeWidth="2.1" strokeLinecap="round" />
      </g>
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
  const showMixStepsControl = !lockFlatBuildMode && showMixStepsToggle;
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
                  <ArrowDownToLine className="h-3 w-3" />
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
            className="h-3.5 w-3.5 accent-primary"
          />
        </label>
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

  if (showMixStepsControl) {
    groups.push({
      key: "mix-steps",
      node: (
        <label
          className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} flex items-center gap-1 cursor-pointer`}
          title={messages.buildMode.mixStepsTooltip}
        >
          <span title={messages.buildMode.mixStepsTooltip}>{messages.buildMode.mixStepsLabel}</span>
          <input
            type="checkbox"
            checked={mixSteps}
            onChange={e => setMixSteps(e.target.checked)}
            title={messages.buildMode.mixStepsTooltip}
            className="h-3.5 w-3.5 accent-primary"
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
            className="h-3.5 w-3.5 accent-primary"
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
            className="h-3.5 w-3.5 accent-primary"
          />
        </label>
      ),
    });
  }

  if (showSuppressDirectionControl) {
    groups.push({
      key: "direction",
      node: (
        <button
          type="button"
          className={INPUT_SQUARE_ICON_BUTTON_CLASS}
          title={messages.buildMode.stepDirectionTooltip(suppressDirection)}
          aria-label={messages.buildMode.stepDirectionAriaLabel(suppressDirection)}
          onClick={() => setSuppressDirection(
            cycleSuppressStepDirection(suppressDirection, isSuppressDirectionSelectable),
          )}
        >
          <SuppressStepDirectionIcon direction={suppressDirection} />
        </button>
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
            className={`bg-input border border-border rounded px-2 h-6 text-xs cursor-help ${
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
                  style={opt.muted ? { color: "var(--muted-foreground)", fontStyle: "italic" } : undefined}
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
          {index > 0 && <span className="h-4 border-l border-border/70" />}
          {group.node}
        </Fragment>
      ))}
    </div>
  );
}
