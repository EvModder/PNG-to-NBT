/**
 * Public API:
 * - SecretsSettingsDialog()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { Dispatch, SetStateAction } from "react";
import { messages } from "@/lib/messages";
import { PANEL_TITLE_TEXT_CLASS } from "@/utils/uiTypography";

type SecretsSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  showTransparentRow: boolean;
  setShowTransparentRow: Dispatch<SetStateAction<boolean>>;
  showExcludedBlocks: boolean;
  setShowExcludedBlocks: Dispatch<SetStateAction<boolean>>;
  forceZ129: boolean;
  setForceZ129: Dispatch<SetStateAction<boolean>>;
  applySupportFloorYs: boolean;
  setApplySupportFloorYs: Dispatch<SetStateAction<boolean>>;
  belowPlatformWater: boolean;
  setBelowPlatformWater: Dispatch<SetStateAction<boolean>>;
  skipEmptySuppressSteps: boolean;
  setSkipEmptySuppressSteps: Dispatch<SetStateAction<boolean>>;
  markSuppressLoadSpotsInSchematic: boolean;
  setMarkSuppressLoadSpotsInSchematic: Dispatch<SetStateAction<boolean>>;
  showAlignmentReminder: boolean;
  setShowAlignmentReminder: Dispatch<SetStateAction<boolean>>;
  showNooblineWarnings: boolean;
  setShowNooblineWarnings: Dispatch<SetStateAction<boolean>>;
  showVsFillerWarnings: boolean;
  setShowVsFillerWarnings: Dispatch<SetStateAction<boolean>>;
};

type OptionRowProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
};

function OptionRow({ checked, onChange, label }: OptionRowProps) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        className="h-3.5 w-3.5"
      />
      <span>{label}</span>
    </label>
  );
}

// Callers:
// - src/Index.tsx
export function SecretsSettingsDialog({
  open,
  onClose,
  showTransparentRow,
  setShowTransparentRow,
  showExcludedBlocks,
  setShowExcludedBlocks,
  forceZ129,
  setForceZ129,
  applySupportFloorYs,
  setApplySupportFloorYs,
  belowPlatformWater,
  setBelowPlatformWater,
  skipEmptySuppressSteps,
  setSkipEmptySuppressSteps,
  markSuppressLoadSpotsInSchematic,
  setMarkSuppressLoadSpotsInSchematic,
  showAlignmentReminder,
  setShowAlignmentReminder,
  showNooblineWarnings,
  setShowNooblineWarnings,
  showVsFillerWarnings,
  setShowVsFillerWarnings,
}: SecretsSettingsDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-card border border-border rounded-md p-3 shadow-lg"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className={PANEL_TITLE_TEXT_CLASS}>{messages.dialogs.secretSettingsTitle}</h2>
          <button
            type="button"
            className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            {messages.common.close}
          </button>
        </div>
        <div className="space-y-2 text-xs">
          <OptionRow
            checked={showTransparentRow}
            onChange={setShowTransparentRow}
            label={messages.dialogs.options.showTransparentRow}
          />
          <OptionRow
            checked={showExcludedBlocks}
            onChange={setShowExcludedBlocks}
            label={messages.dialogs.options.showExcludedBlocks}
          />
          <OptionRow
            checked={forceZ129}
            onChange={setForceZ129}
            label={messages.dialogs.options.forceZ129}
          />
          <OptionRow
            checked={applySupportFloorYs}
            onChange={setApplySupportFloorYs}
            label={messages.dialogs.options.assumeFloor}
          />
          <OptionRow
            checked={belowPlatformWater}
            onChange={setBelowPlatformWater}
            label={messages.dialogs.options.belowPlatformWater}
          />
          <OptionRow
            checked={skipEmptySuppressSteps}
            onChange={setSkipEmptySuppressSteps}
            label={messages.dialogs.options.skipEmptySuppressSteps}
          />
          <OptionRow
            checked={markSuppressLoadSpotsInSchematic}
            onChange={setMarkSuppressLoadSpotsInSchematic}
            label={messages.dialogs.options.markSuppressLoadSpotsInSchematic}
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
        </div>
      </div>
    </div>
  );
}
