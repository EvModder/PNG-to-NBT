/**
 * Public API:
 * - ToolbarPresetSettings()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { RefObject } from "react";
import { messages } from "@/lib/messages";
import { type BlockPreset } from "@/data/presets";
import { SupportMode } from "@/types/ui";
import { ToolbarBuildSettings, type ToolbarBuildSettingsProps } from "@/components/ToolbarBuildSettings";

type ToolbarPresetSettingsProps = {
  toolbarRef: RefObject<HTMLElement | null>;
  isStackedLayout: boolean;
  presets: BlockPreset[];
  builtInPresetCount: number;
  activeIdx: number;
  selectPreset: (idx: number) => void;
  activePresetBuiltinTooltip: string;
  presetDirty: boolean;
  isBuiltinUnedited: boolean;
  sharePreset: () => Promise<void>;
  presetPrimaryActionTitle: string;
  presetPrimaryActionLabel: string;
  deletePreset: () => void;
  createPreset: () => void;
  showSupportModeSelector: boolean;
  supportMode: SupportMode;
  setSupportMode: (mode: SupportMode) => void;
  supportModeTooltip: string;
  enableAllSupportOption: boolean;
  enableStepsSupportOption: boolean;
  enableWaterSupportOption: boolean;
  enableFragileSupportOption: boolean;
  supportFillerIsFragile: boolean;
  buildSettingsProps: ToolbarBuildSettingsProps | null;
};

// Callers:
// - src/Index.tsx
export function ToolbarPresetSettings({
  toolbarRef,
  isStackedLayout,
  presets,
  builtInPresetCount,
  activeIdx,
  selectPreset,
  activePresetBuiltinTooltip,
  presetDirty,
  isBuiltinUnedited,
  sharePreset,
  presetPrimaryActionTitle,
  presetPrimaryActionLabel,
  deletePreset,
  createPreset,
  showSupportModeSelector,
  supportMode,
  setSupportMode,
  supportModeTooltip,
  enableAllSupportOption,
  enableStepsSupportOption,
  enableWaterSupportOption,
  enableFragileSupportOption,
  supportFillerIsFragile,
  buildSettingsProps,
}: ToolbarPresetSettingsProps) {
  const canDeletePreset = activeIdx >= builtInPresetCount && presets.length > builtInPresetCount;

  return (
    <section ref={toolbarRef} className="bg-card border border-border rounded-md p-1.5">
      <div
        className={`flex gap-1.5 items-center ${isStackedLayout ? "flex-wrap" : "flex-nowrap"}`}
      >
        <div className="inline-flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-semibold text-accent">{messages.presets.label}</span>
          <div className="inline-flex items-center gap-1">
            <select
              className="bg-input border border-border rounded px-2 h-6 text-foreground text-xs"
              value={activeIdx}
              onChange={e => selectPreset(Number(e.target.value))}
              title={activePresetBuiltinTooltip}
            >
              <optgroup label={messages.presets.builtInGroupLabel}>
                {presets.slice(0, builtInPresetCount).map((preset, idx) => (
                  <option key={idx} value={idx} title={messages.presets.builtinTooltip(preset.name)}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
              {presets.length > builtInPresetCount && (
                <optgroup label={messages.presets.customGroupLabel}>
                  {presets.slice(builtInPresetCount).map((preset, idx) => (
                    <option key={idx + builtInPresetCount} value={idx + builtInPresetCount}>
                      {preset.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {presetDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title={messages.common.unsavedChanges} />
            )}
          </div>
          {!isBuiltinUnedited && (
            <button
              className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground"
              onClick={() => { void sharePreset(); }}
              title={presetPrimaryActionTitle}
            >
              {presetPrimaryActionLabel}
            </button>
          )}
          {canDeletePreset && (
            <button
              className="text-xs px-2 py-0.5 rounded border border-destructive text-destructive hover:bg-destructive/20"
              onClick={deletePreset}
              title={messages.presets.deleteTitle}
            >
              {messages.common.deleteShort}
            </button>
          )}
          <button
            className="text-xs px-1.5 py-0.5 rounded border border-primary text-primary hover:bg-primary/20"
            onClick={createPreset}
            title={messages.common.newPresetTitle}
          >
            +
          </button>
        </div>
        {showSupportModeSelector && (
          <>
            <span className="h-4 border-l border-border/70" />
            <div className="inline-flex items-center gap-1 shrink-0">
              <span className="text-xs font-semibold text-accent whitespace-nowrap">{messages.supportMode.label}</span>
              <select
                className="bg-input border border-border rounded px-1 h-6 text-foreground text-xs cursor-help"
                value={supportMode}
                onChange={e => setSupportMode(e.target.value as SupportMode)}
                title={supportModeTooltip}
              >
                <option value={SupportMode.All} disabled={!enableAllSupportOption} title={messages.supportMode.tooltip(SupportMode.All)}>
                  {messages.supportMode.optionLabel(SupportMode.All)}
                </option>
                <option value={SupportMode.None} title={messages.supportMode.tooltip(SupportMode.None)}>
                  {messages.supportMode.optionLabel(SupportMode.None)}
                </option>
                <option value={SupportMode.Steps} disabled={!enableStepsSupportOption} title={messages.supportMode.tooltip(SupportMode.Steps)}>
                  {messages.supportMode.optionLabel(SupportMode.Steps)}
                </option>
                <option value={SupportMode.Water} disabled={!enableWaterSupportOption} title={messages.supportMode.tooltip(SupportMode.Water)}>
                  {messages.supportMode.optionLabel(SupportMode.Water)}
                </option>
                <option
                  value={SupportMode.Fragile}
                  disabled={supportFillerIsFragile || !enableFragileSupportOption}
                  title={messages.supportMode.tooltip(SupportMode.Fragile)}
                >
                  {messages.supportMode.optionLabel(SupportMode.Fragile)}
                </option>
              </select>
            </div>
          </>
        )}
        {buildSettingsProps && <ToolbarBuildSettings {...buildSettingsProps} />}
      </div>
    </section>
  );
}
