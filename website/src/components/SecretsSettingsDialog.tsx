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
  SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS,
  type SuppressLoadSpotMarkerBlock,
} from "@/data/defaultSettings";
import { messages } from "@/lib/messages";
import { MUTED_SQUARE_ICON_BUTTON_CLASS } from "@/utils/uiButtons";
import { PANEL_TITLE_TEXT_CLASS } from "@/utils/uiTypography";

const SUPPRESS_LOAD_SPOT_MARKER_SELECT_WIDTH_CH = Math.max(
  ...SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS.map(block => block.length),
);

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
  markSuppressLoadSpotsInSchematic: boolean;
  setMarkSuppressLoadSpotsInSchematic: Dispatch<SetStateAction<boolean>>;
  suppressLoadSpotMarkerBlock: SuppressLoadSpotMarkerBlock;
  setSuppressLoadSpotMarkerBlock: Dispatch<SetStateAction<SuppressLoadSpotMarkerBlock>>;
  showVsFillerWarnings: boolean;
  setShowVsFillerWarnings: Dispatch<SetStateAction<boolean>>;
  showAlignmentReminder: boolean;
  setShowAlignmentReminder: Dispatch<SetStateAction<boolean>>;
  showNooblineWarnings: boolean;
  setShowNooblineWarnings: Dispatch<SetStateAction<boolean>>;
};

type OptionRowProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
};

function OptionRow({ checked, onChange, label, disabled = false }: OptionRowProps) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
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

type OptionSelectRowProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  value: SuppressLoadSpotMarkerBlock;
  onValueChange: (value: SuppressLoadSpotMarkerBlock) => void;
  selectLabel: string;
};

function OptionSelectRow({
  checked,
  onCheckedChange,
  label,
  value,
  onValueChange,
  selectLabel,
}: OptionSelectRowProps) {
  return (
    <div className="flex items-center gap-2">
      <label className="flex min-w-0 flex-1 items-center gap-2 cursor-pointer">
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
        onChange={event => onValueChange(event.target.value as SuppressLoadSpotMarkerBlock)}
        aria-label={selectLabel}
        className="min-w-0 shrink-0 rounded border border-border bg-input px-1.5 py-0.5 text-xs text-foreground"
        style={{ width: `calc(${SUPPRESS_LOAD_SPOT_MARKER_SELECT_WIDTH_CH}ch + 2.75rem)` }}
      >
        {SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS.map(block => (
          <option key={block} value={block}>{block}</option>
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
  markSuppressLoadSpotsInSchematic,
  setMarkSuppressLoadSpotsInSchematic,
  suppressLoadSpotMarkerBlock,
  setSuppressLoadSpotMarkerBlock,
  showVsFillerWarnings,
  setShowVsFillerWarnings,
  showAlignmentReminder,
  setShowAlignmentReminder,
  showNooblineWarnings,
  setShowNooblineWarnings,
}: SecretsSettingsDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-md p-3 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={messages.dialogs.secretSettingsTitle}
        onKeyDown={event => {
          if (event.key !== "Escape") return;
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
        <div className="space-y-2 text-xs">
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
          <OptionSelectRow
            checked={markSuppressLoadSpotsInSchematic}
            onCheckedChange={setMarkSuppressLoadSpotsInSchematic}
            label={messages.dialogs.options.markSuppressLoadSpotsInSchematic}
            value={suppressLoadSpotMarkerBlock}
            onValueChange={setSuppressLoadSpotMarkerBlock}
            selectLabel={messages.dialogs.options.suppressLoadSpotMarkerBlock}
          />
          <OptionRow
            checked={showVsFillerWarnings}
            onChange={setShowVsFillerWarnings}
            label={messages.dialogs.options.showVsFillerWarnings}
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
        </div>
      </div>
    </div>
  );
}
