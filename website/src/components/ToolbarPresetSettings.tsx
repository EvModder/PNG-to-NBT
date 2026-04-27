/**
 * Public API:
 * - ToolbarPresetSettings()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { RefObject } from "react";
import { Plus, Save, Share2, Trash2 } from "lucide-react";
import { messages } from "@/lib/messages";
import { type BlockPreset } from "@/data/presets";
import { SupportMode } from "@/types/ui";
import { ToolbarBuildSettings, type ToolbarBuildSettingsProps } from "@/components/ToolbarBuildSettings";
import {
  DESTRUCTIVE_SQUARE_ICON_BUTTON_CLASS,
  MUTED_SQUARE_ICON_BUTTON_CLASS,
  PRIMARY_SQUARE_ICON_BUTTON_CLASS,
} from "@/utils/uiButtons";
import { ACCENT_SMALL_LABEL_TEXT_CLASS } from "@/utils/uiTypography";

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
    <section ref={toolbarRef} className="bg-card border border-border rounded-md py-1.5 pr-1.5 pl-2">
      <div
        className={`flex gap-1.5 items-center ${isStackedLayout ? "flex-wrap" : "flex-nowrap"}`}
      >
        <div className="inline-flex items-center gap-1.5 shrink-0">
          <span className={ACCENT_SMALL_LABEL_TEXT_CLASS}>{messages.presets.label}</span>
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
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 cursor-help" title={messages.common.unsavedChanges} />
            )}
          </div>
          {!isBuiltinUnedited && (
            <button
              className={MUTED_SQUARE_ICON_BUTTON_CLASS}
              onClick={() => { void sharePreset(); }}
              title={presetPrimaryActionTitle}
              aria-label={presetPrimaryActionTitle}
            >
              {presetDirty ? <Save size={14} /> : <Share2 size={14} />}
            </button>
          )}
          {canDeletePreset && (
            <button
              className={DESTRUCTIVE_SQUARE_ICON_BUTTON_CLASS}
              onClick={deletePreset}
              title={messages.presets.deleteTitle}
              aria-label={messages.presets.deleteTitle}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            className={PRIMARY_SQUARE_ICON_BUTTON_CLASS}
            onClick={createPreset}
            title={messages.common.newPresetTitle}
            aria-label={messages.common.newPresetTitle}
          >
            <Plus size={14} />
          </button>
        </div>
        {showSupportModeSelector && (
          <>
            <span className="h-4 border-l border-border/70" />
            <div className="inline-flex items-center gap-1 shrink-0">
              <span className={ACCENT_SMALL_LABEL_TEXT_CLASS}>{messages.supportMode.label}</span>
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
