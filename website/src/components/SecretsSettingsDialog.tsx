/**
 * Public API:
 * - SecretsSettingsDialog()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { Dispatch, SetStateAction } from "react";
import { X } from "lucide-react";
import {
  INVALID_DIMENSIONS_STRATEGY_OPTIONS,
  SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS,
  type InvalidDimensionsStrategy,
  type SuppressLoadSpotMarkerBlock,
} from "@/data/defaultSettings";
import { messages } from "@/lib/messages";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { MUTED_SQUARE_ICON_BUTTON_CLASS } from "@/utils/uiButtons";
import { PANEL_TITLE_TEXT_CLASS } from "@/utils/uiTypography";

// Dropdowns share a width so the column lines up; the widest option wins.
const SETTINGS_SELECT_WIDTH_CH = Math.max(
  ...SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS.map(block => block.length),
  ...Object.values(MINECRAFT_VERSIONS).map(version => version.label.length),
  ...INVALID_DIMENSIONS_STRATEGY_OPTIONS.map(
    strategy => messages.dialogs.options.invalidDimensionsStrategies[strategy].length,
  ),
);
const SETTINGS_SELECT_WIDTH = `calc(${SETTINGS_SELECT_WIDTH_CH}ch + 2.75rem)`;

type SecretsSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  showTransparentRow: boolean;
  setShowTransparentRow: Dispatch<SetStateAction<boolean>>;
  showTransparentRowDisabled?: boolean;
  showExcludedBlocks: boolean;
  setShowExcludedBlocks: Dispatch<SetStateAction<boolean>>;
  collapseDuplicateNbtPaletteStates: boolean;
  setCollapseDuplicateNbtPaletteStates: Dispatch<SetStateAction<boolean>>;
  forceXZ128: boolean;
  setForceXZ128: Dispatch<SetStateAction<boolean>>;
  forceXZ128Disabled?: boolean;
  forceZ129: boolean;
  setForceZ129: Dispatch<SetStateAction<boolean>>;
  forceZ129Disabled?: boolean;
  applySupportFloorYs: boolean;
  setApplySupportFloorYs: Dispatch<SetStateAction<boolean>>;
  applySupportFloorYsDisabled?: boolean;
  belowPlatformWater: boolean;
  setBelowPlatformWater: Dispatch<SetStateAction<boolean>>;
  belowPlatformWaterDisabled?: boolean;
  skipEmptySuppressSteps: boolean;
  setSkipEmptySuppressSteps: Dispatch<SetStateAction<boolean>>;
  showFlatNbtSuppressStepModes: boolean;
  setShowFlatNbtSuppressStepModes: Dispatch<SetStateAction<boolean>>;
  showAlignmentReminder: boolean;
  setShowAlignmentReminder: Dispatch<SetStateAction<boolean>>;
  showNooblineWarnings: boolean;
  setShowNooblineWarnings: Dispatch<SetStateAction<boolean>>;
  showVsFillerWarnings: boolean;
  setShowVsFillerWarnings: Dispatch<SetStateAction<boolean>>;
  markSuppressLoadSpotsInSchematic: boolean;
  setMarkSuppressLoadSpotsInSchematic: Dispatch<SetStateAction<boolean>>;
  suppressLoadSpotMarkerBlock: SuppressLoadSpotMarkerBlock;
  setSuppressLoadSpotMarkerBlock: Dispatch<SetStateAction<SuppressLoadSpotMarkerBlock>>;
  autoFixInvalidDimensions: boolean;
  setAutoFixInvalidDimensions: Dispatch<SetStateAction<boolean>>;
  invalidDimensionsStrategy: InvalidDimensionsStrategy;
  setInvalidDimensionsStrategy: Dispatch<SetStateAction<InvalidDimensionsStrategy>>;
  minecraftVersion: MinecraftVersion;
  setMinecraftVersion: Dispatch<SetStateAction<MinecraftVersion>>;
};

type OptionRowProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

function OptionRow({ checked, onChange, label, disabled = false }: OptionRowProps) {
  return (
    <label className={`flex items-center gap-1 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        className="h-3.5 w-3.5"
      />
      <span>{label}</span>
    </label>
  );
}

type OptionSelectRowProps<T extends string> = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly T[];
  optionLabel?: (value: T) => string;
  selectLabel: string;
};

function OptionSelectRow<T extends string>({
  checked,
  onCheckedChange,
  label,
  value,
  onValueChange,
  options,
  optionLabel,
  selectLabel,
}: OptionSelectRowProps<T>) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-1 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={event => onCheckedChange(event.target.checked)}
          className="h-3.5 w-3.5"
        />
        <span className="min-w-0">{label}</span>
      </label>
      <select
        value={value}
        onChange={event => onValueChange(event.target.value as T)}
        aria-label={selectLabel}
        className="h-6 min-w-0 shrink-0 rounded border border-border bg-input px-1.5 text-xs text-foreground"
        style={{ width: SETTINGS_SELECT_WIDTH }}
      >
        {options.map(option => (
          <option key={option} value={option}>{optionLabel ? optionLabel(option) : option}</option>
        ))}
      </select>
    </div>
  );
}

// Callers:
// - src/Index.tsx
export function SecretsSettingsDialog({
  open,
  onClose,
  showTransparentRow,
  setShowTransparentRow,
  showTransparentRowDisabled = false,
  showExcludedBlocks,
  setShowExcludedBlocks,
  collapseDuplicateNbtPaletteStates,
  setCollapseDuplicateNbtPaletteStates,
  forceXZ128,
  setForceXZ128,
  forceXZ128Disabled = false,
  forceZ129,
  setForceZ129,
  forceZ129Disabled = false,
  applySupportFloorYs,
  setApplySupportFloorYs,
  applySupportFloorYsDisabled = false,
  belowPlatformWater,
  setBelowPlatformWater,
  belowPlatformWaterDisabled = false,
  skipEmptySuppressSteps,
  setSkipEmptySuppressSteps,
  showFlatNbtSuppressStepModes,
  setShowFlatNbtSuppressStepModes,
  showAlignmentReminder,
  setShowAlignmentReminder,
  showNooblineWarnings,
  setShowNooblineWarnings,
  showVsFillerWarnings,
  setShowVsFillerWarnings,
  markSuppressLoadSpotsInSchematic,
  setMarkSuppressLoadSpotsInSchematic,
  suppressLoadSpotMarkerBlock,
  setSuppressLoadSpotMarkerBlock,
  autoFixInvalidDimensions,
  setAutoFixInvalidDimensions,
  invalidDimensionsStrategy,
  setInvalidDimensionsStrategy,
  minecraftVersion,
  setMinecraftVersion,
}: SecretsSettingsDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-md p-2 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={messages.dialogs.secretSettingsTitle}
        onKeyDown={event => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onClose();
        }}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className={PANEL_TITLE_TEXT_CLASS}>{messages.dialogs.secretSettingsTitle}</h2>
          <button
            type="button"
            className={MUTED_SQUARE_ICON_BUTTON_CLASS}
            title={messages.common.close}
            aria-label={messages.common.close}
            autoFocus
            onClick={onClose}
          >
            <X size={14} strokeWidth={2.1} />
          </button>
        </div>
        <div className="space-y-0.5 text-xs [&>*]:min-h-6">
          <OptionRow
            checked={showTransparentRow}
            onChange={setShowTransparentRow}
            label={messages.dialogs.options.showTransparentRow}
            disabled={showTransparentRowDisabled}
          />
          <OptionRow
            checked={showExcludedBlocks}
            onChange={setShowExcludedBlocks}
            label={messages.dialogs.options.showExcludedBlocks}
          />
          <OptionRow
            checked={collapseDuplicateNbtPaletteStates}
            onChange={setCollapseDuplicateNbtPaletteStates}
            label={messages.dialogs.options.collapseDuplicateNbtPaletteStates}
          />
          <OptionRow
            checked={forceXZ128}
            onChange={setForceXZ128}
            label={messages.dialogs.options.forceXZ128}
            disabled={forceXZ128Disabled}
          />
          <OptionRow
            checked={forceZ129}
            onChange={setForceZ129}
            label={messages.dialogs.options.forceZ129}
            disabled={forceZ129Disabled}
          />
          <OptionRow
            checked={applySupportFloorYs}
            onChange={setApplySupportFloorYs}
            label={messages.dialogs.options.assumeFloor}
            disabled={applySupportFloorYsDisabled}
          />
          <OptionRow
            checked={belowPlatformWater}
            onChange={setBelowPlatformWater}
            label={messages.dialogs.options.belowPlatformWater}
            disabled={belowPlatformWaterDisabled}
          />
          <OptionRow
            checked={skipEmptySuppressSteps}
            onChange={setSkipEmptySuppressSteps}
            label={messages.dialogs.options.skipEmptySuppressSteps}
          />
          <OptionRow
            checked={showFlatNbtSuppressStepModes}
            onChange={setShowFlatNbtSuppressStepModes}
            label={messages.dialogs.options.showFlatNbtSuppressStepModes}
          />
          <OptionRow
            checked={showAlignmentReminder}
            onChange={setShowAlignmentReminder}
            label={messages.dialogs.options.showAlignmentReminder}
          />
          <OptionRow
            checked={showNooblineWarnings}
            onChange={setShowNooblineWarnings}
            label={messages.dialogs.options.showNooblineWarnings}
          />
          <OptionRow
            checked={showVsFillerWarnings}
            onChange={setShowVsFillerWarnings}
            label={messages.dialogs.options.showVsFillerWarnings}
          />
          <OptionSelectRow<SuppressLoadSpotMarkerBlock>
            checked={markSuppressLoadSpotsInSchematic}
            onCheckedChange={setMarkSuppressLoadSpotsInSchematic}
            label={messages.dialogs.options.markSuppressLoadSpotsInSchematic}
            value={suppressLoadSpotMarkerBlock}
            onValueChange={setSuppressLoadSpotMarkerBlock}
            options={SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS}
            selectLabel={messages.dialogs.options.suppressLoadSpotMarkerBlock}
          />
          <OptionSelectRow<InvalidDimensionsStrategy>
            checked={autoFixInvalidDimensions}
            onCheckedChange={setAutoFixInvalidDimensions}
            label={messages.dialogs.options.autoFixInvalidDimensions}
            value={invalidDimensionsStrategy}
            onValueChange={setInvalidDimensionsStrategy}
            options={INVALID_DIMENSIONS_STRATEGY_OPTIONS}
            optionLabel={strategy => messages.dialogs.options.invalidDimensionsStrategies[strategy]}
            selectLabel={messages.dialogs.options.invalidDimensionsStrategy}
          />
          <label className="flex items-center justify-between gap-2">
            <span>{messages.dialogs.options.minecraftVersion}</span>
            <select
              value={minecraftVersion}
              aria-label={messages.dialogs.options.minecraftVersion}
              onChange={event => setMinecraftVersion(event.target.value as MinecraftVersion)}
              className="h-6 min-w-0 shrink-0 rounded border border-border bg-input px-1.5 text-xs text-foreground"
              style={{ width: SETTINGS_SELECT_WIDTH }}
            >
              {Object.entries(MINECRAFT_VERSIONS).map(([version, { label }]) => (
                <option key={version} value={version}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
