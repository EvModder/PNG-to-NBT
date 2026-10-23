/**
 * Public API:
 * - SecretsSettingsDialog()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { Dispatch, SetStateAction } from "react";
import { X, Printer, Pickaxe } from "lucide-react";
import {
  SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS,
  PIXEL_ART_SCALE_MODE_OPTIONS,
  INVALID_DIMENSIONS_STRATEGY_OPTIONS,
  INVALID_COLORS_PALETTE_OPTIONS,
  type SuppressLoadSpotMarkerBlock,
  type PixelArtScaleMode,
  type InvalidDimensionsStrategy,
  type InvalidColorsPalette,
} from "@/data/defaultSettings";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { messages } from "@/lib/messages";
import { MUTED_SQUARE_ICON_BUTTON_CLASS, PANEL_TITLE_TEXT_CLASS } from "@/data/uiClasses";

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
  skipEmptySuppressStepsDisabled?: boolean;
  minSuppressStepOffset: number;
  setMinSuppressStepOffset: Dispatch<SetStateAction<number>>;
  uniformSuppressStepSpacing: boolean;
  setUniformSuppressStepSpacing: Dispatch<SetStateAction<boolean>>;
  suppressStepSpacingDisabled: boolean;
  showAlignmentReminder: boolean;
  setShowAlignmentReminder: Dispatch<SetStateAction<boolean>>;
  showNooblineWarnings: boolean;
  setShowNooblineWarnings: Dispatch<SetStateAction<boolean>>;
  showVsFillerWarnings: boolean;
  setShowVsFillerWarnings: Dispatch<SetStateAction<boolean>>;
  showFlatNbtSuppressStepModes: boolean;
  setShowFlatNbtSuppressStepModes: Dispatch<SetStateAction<boolean>>;
  mixedStepReachableTop: boolean;
  setMixedStepReachableTop: Dispatch<SetStateAction<boolean>>;
  maxStepColorBlockLift: number;
  setMaxStepColorBlockLift: Dispatch<SetStateAction<number>>;
  markSuppressLoadSpotsInSchematic: boolean;
  setMarkSuppressLoadSpotsInSchematic: Dispatch<SetStateAction<boolean>>;
  suppressLoadSpotMarkerBlock: SuppressLoadSpotMarkerBlock;
  setSuppressLoadSpotMarkerBlock: Dispatch<SetStateAction<SuppressLoadSpotMarkerBlock>>;
  autoScalePixelArt: boolean;
  setAutoScalePixelArt: Dispatch<SetStateAction<boolean>>;
  pixelArtScaleMode: PixelArtScaleMode;
  setPixelArtScaleMode: Dispatch<SetStateAction<PixelArtScaleMode>>;
  autoFixInvalidDimensions: boolean;
  setAutoFixInvalidDimensions: Dispatch<SetStateAction<boolean>>;
  invalidDimensionsStrategy: InvalidDimensionsStrategy;
  setInvalidDimensionsStrategy: Dispatch<SetStateAction<InvalidDimensionsStrategy>>;
  autoFixInvalidColors: boolean;
  setAutoFixInvalidColors: Dispatch<SetStateAction<boolean>>;
  invalidColorsPalette: InvalidColorsPalette;
  setInvalidColorsPalette: Dispatch<SetStateAction<InvalidColorsPalette>>;
  hasPresetColors: boolean;
  minecraftVersion: MinecraftVersion;
  setMinecraftVersion: (version: MinecraftVersion) => void;
};

type OptionRowProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  title?: string;
  disabled?: boolean;
};

function OptionRow({ checked, onChange, label, title, disabled = false }: OptionRowProps) {
  return (
    <label title={title} className={`flex items-center gap-1 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
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
  optionDisabled?: (value: T) => boolean;
  selectLabel: string;
  title: string;
};

function OptionSelectRow<T extends string>({
  checked,
  onCheckedChange,
  label,
  value,
  onValueChange,
  options,
  optionLabel,
  optionDisabled,
  selectLabel,
  title,
}: OptionSelectRowProps<T>) {
  return (
    <div className="grid grid-cols-subgrid items-center" title={title}>
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
      >
        {options.map(option => (
          <option key={option} value={option} disabled={optionDisabled?.(option)}>{optionLabel ? optionLabel(option) : option}</option>
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
  skipEmptySuppressStepsDisabled = false,
  minSuppressStepOffset,
  setMinSuppressStepOffset,
  uniformSuppressStepSpacing,
  setUniformSuppressStepSpacing,
  suppressStepSpacingDisabled,
  showAlignmentReminder,
  setShowAlignmentReminder,
  showNooblineWarnings,
  setShowNooblineWarnings,
  showVsFillerWarnings,
  setShowVsFillerWarnings,
  showFlatNbtSuppressStepModes,
  setShowFlatNbtSuppressStepModes,
  mixedStepReachableTop,
  setMixedStepReachableTop,
  maxStepColorBlockLift,
  setMaxStepColorBlockLift,
  markSuppressLoadSpotsInSchematic,
  setMarkSuppressLoadSpotsInSchematic,
  suppressLoadSpotMarkerBlock,
  setSuppressLoadSpotMarkerBlock,
  autoScalePixelArt,
  setAutoScalePixelArt,
  pixelArtScaleMode,
  setPixelArtScaleMode,
  autoFixInvalidDimensions,
  setAutoFixInvalidDimensions,
  invalidDimensionsStrategy,
  setInvalidDimensionsStrategy,
  autoFixInvalidColors,
  setAutoFixInvalidColors,
  invalidColorsPalette,
  setInvalidColorsPalette,
  hasPresetColors,
  minecraftVersion,
  setMinecraftVersion,
}: SecretsSettingsDialogProps) {
  if (!open) return null;
  const [liftLabelBefore, liftLabelAfter] = messages.dialogs.options.maxStepColorBlockLift.split("{printerNuker}");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card border border-border rounded-md p-2 shadow-lg [&_:is(h2,span)]:truncate [&_h2]:leading-normal [&_input]:shrink-0"
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
        <div className="grid grid-cols-[minmax(0,1fr)_max-content] gap-x-2 gap-y-0.5 text-xs [&>*]:col-span-2 [&>*]:min-h-6">
          <OptionRow
            checked={showTransparentRow}
            onChange={setShowTransparentRow}
            label={messages.dialogs.options.showTransparentRow}
            title={messages.dialogs.options.showTransparentRowTooltip}
            disabled={showTransparentRowDisabled}
          />
          <OptionRow
            checked={showExcludedBlocks}
            onChange={setShowExcludedBlocks}
            label={messages.dialogs.options.showExcludedBlocks}
            title={messages.dialogs.options.showExcludedBlocksTooltip}
          />
          <OptionRow
            checked={collapseDuplicateNbtPaletteStates}
            onChange={setCollapseDuplicateNbtPaletteStates}
            label={messages.dialogs.options.collapseDuplicateNbtPaletteStates}
            title={messages.dialogs.options.collapseDuplicateNbtPaletteStatesTooltip}
          />
          <OptionRow
            checked={forceXZ128}
            onChange={setForceXZ128}
            label={messages.dialogs.options.forceXZ128}
            title={messages.dialogs.options.forceXZ128Tooltip}
            disabled={forceXZ128Disabled}
          />
          <OptionRow
            checked={forceZ129}
            onChange={setForceZ129}
            label={messages.dialogs.options.forceZ129}
            title={messages.dialogs.options.forceZ129Tooltip}
            disabled={forceZ129Disabled}
          />
          <OptionRow
            checked={applySupportFloorYs}
            onChange={setApplySupportFloorYs}
            label={messages.dialogs.options.assumeFloor}
            title={messages.dialogs.options.assumeFloorTooltip}
            disabled={applySupportFloorYsDisabled}
          />
          <OptionRow
            checked={belowPlatformWater}
            onChange={setBelowPlatformWater}
            label={messages.dialogs.options.belowPlatformWater}
            title={messages.dialogs.options.belowPlatformWaterTooltip}
            disabled={belowPlatformWaterDisabled}
          />
          <OptionRow
            checked={showAlignmentReminder}
            onChange={setShowAlignmentReminder}
            label={messages.dialogs.options.showAlignmentReminder}
            title={messages.dialogs.options.showAlignmentReminderTooltip}
          />
          <OptionRow
            checked={showNooblineWarnings}
            onChange={setShowNooblineWarnings}
            label={messages.dialogs.options.showNooblineWarnings}
            title={messages.dialogs.options.showNooblineWarningsTooltip}
          />
          <OptionRow
            checked={showVsFillerWarnings}
            onChange={setShowVsFillerWarnings}
            label={messages.dialogs.options.showVsFillerWarnings}
            title={messages.dialogs.options.showVsFillerWarningsTooltip}
          />
          <OptionRow
            checked={showFlatNbtSuppressStepModes}
            onChange={setShowFlatNbtSuppressStepModes}
            label={messages.dialogs.options.showFlatNbtSuppressStepModes}
          />
          <OptionRow
            checked={skipEmptySuppressSteps}
            onChange={setSkipEmptySuppressSteps}
            label={messages.dialogs.options.skipEmptySuppressSteps}
            title={skipEmptySuppressStepsDisabled ? messages.dialogs.options.skipEmptySuppressStepsDisabledTooltip : messages.dialogs.options.skipEmptySuppressStepsTooltip}
            disabled={skipEmptySuppressStepsDisabled}
          />
          <div className="grid grid-cols-subgrid items-center">
            <OptionRow
              checked={uniformSuppressStepSpacing}
              onChange={setUniformSuppressStepSpacing}
              label={messages.dialogs.options.uniformSuppressStepSpacing}
              title={messages.dialogs.options.uniformSuppressStepSpacingTooltip}
              disabled={suppressStepSpacingDisabled}
            />
            <label
              className={`flex items-center justify-end gap-1 ${suppressStepSpacingDisabled ? "cursor-not-allowed opacity-60" : ""}`}
              title={messages.dialogs.options.minSuppressStepOffsetTooltip}
            >
              <span>{messages.dialogs.options.minSuppressStepOffset}</span>
              <input
                type="number"
                min={1}
                max={20}
                step={1}
                value={minSuppressStepOffset}
                disabled={suppressStepSpacingDisabled}
                onChange={event => {
                  const value = Number(event.target.value);
                  if (Number.isSafeInteger(value)) setMinSuppressStepOffset(Math.min(20, Math.max(1, value)));
                }}
                className="h-6 w-16 rounded border border-border bg-input px-1.5 text-xs text-foreground"
              />
            </label>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-2">
            <OptionRow
              checked={maxStepColorBlockLift === 1 && mixedStepReachableTop}
              onChange={setMixedStepReachableTop}
              label={messages.dialogs.options.mixedStepReachableTop}
              title={messages.dialogs.options.mixedStepReachableTopTooltip}
              disabled={maxStepColorBlockLift !== 1}
            />
            <label
              className="flex items-center justify-end gap-1"
              title={messages.dialogs.options.maxStepColorBlockLiftTooltip}
            >
              <span className="inline-flex items-center">
                <span className="mr-0.5">{liftLabelBefore}</span>
                <span aria-hidden="true" className="inline-flex items-center gap-px">
                  <Printer className="h-4 w-4" />
                  <span className="-mr-px">+</span>
                  <Pickaxe className="h-4 w-4 mr-[0.25px]" />
                </span>
                <span className="sr-only">{messages.buildMode.mixStepsLabel}</span>
                {liftLabelAfter}
              </span>
              <input
                type="number"
                min={0}
                max={10}
                step={1}
                value={maxStepColorBlockLift}
                onChange={event => {
                  const value = Number(event.target.value);
                  if (Number.isSafeInteger(value)) setMaxStepColorBlockLift(Math.min(10, Math.max(0, value)));
                }}
                className="h-6 w-16 rounded border border-border bg-input px-1.5 text-xs text-foreground"
              />
            </label>
          </div>
          <OptionSelectRow<SuppressLoadSpotMarkerBlock>
            checked={markSuppressLoadSpotsInSchematic}
            onCheckedChange={setMarkSuppressLoadSpotsInSchematic}
            label={messages.dialogs.options.markSuppressLoadSpotsInSchematic}
            title={messages.dialogs.options.markSuppressLoadSpotsInSchematicTooltip}
            value={suppressLoadSpotMarkerBlock}
            onValueChange={setSuppressLoadSpotMarkerBlock}
            options={SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS}
            selectLabel={messages.dialogs.options.suppressLoadSpotMarkerBlock}
          />
          <OptionSelectRow<PixelArtScaleMode>
            checked={autoScalePixelArt}
            onCheckedChange={setAutoScalePixelArt}
            label={messages.dialogs.options.autoScalePixelArt}
            title={messages.dialogs.options.autoScalePixelArtTooltip}
            value={pixelArtScaleMode}
            onValueChange={setPixelArtScaleMode}
            options={PIXEL_ART_SCALE_MODE_OPTIONS}
            optionLabel={mode => messages.dialogs.options.pixelArtScaleModes[mode]}
            selectLabel={messages.dialogs.options.pixelArtScaleMode}
          />
          <OptionSelectRow<InvalidDimensionsStrategy>
            checked={autoFixInvalidDimensions}
            onCheckedChange={setAutoFixInvalidDimensions}
            label={messages.dialogs.options.autoFixInvalidDimensions}
            title={messages.dialogs.options.autoFixInvalidDimensionsTooltip}
            value={invalidDimensionsStrategy}
            onValueChange={setInvalidDimensionsStrategy}
            options={INVALID_DIMENSIONS_STRATEGY_OPTIONS}
            optionLabel={strategy => messages.dialogs.options.invalidDimensionsStrategies[strategy]}
            selectLabel={messages.dialogs.options.invalidDimensionsStrategy}
          />
          <OptionSelectRow<InvalidColorsPalette>
            checked={autoFixInvalidColors}
            onCheckedChange={setAutoFixInvalidColors}
            label={messages.dialogs.options.autoFixInvalidColors}
            title={messages.dialogs.options.autoFixInvalidColorsTooltip}
            value={invalidColorsPalette}
            onValueChange={setInvalidColorsPalette}
            options={INVALID_COLORS_PALETTE_OPTIONS}
            optionLabel={palette => messages.dialogs.options.invalidColorsPalettes[palette]}
            optionDisabled={palette => palette !== "full" && !hasPresetColors}
            selectLabel={messages.dialogs.options.invalidColorsPalette}
          />
          <label className="grid grid-cols-subgrid items-center" title={messages.dialogs.options.minecraftVersionTooltip}>
            <span>{messages.dialogs.options.minecraftVersion}</span>
            <select
              value={minecraftVersion}
              aria-label={messages.dialogs.options.minecraftVersion}
              onChange={event => setMinecraftVersion(event.target.value as MinecraftVersion)}
              className="h-6 min-w-0 shrink-0 rounded border border-border bg-input px-1.5 text-xs text-foreground"
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
