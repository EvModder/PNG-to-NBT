import type { Dispatch, SetStateAction } from "react";
import { BASE_COLORS } from "@/data/mapColors";
import { messages } from "@/lib/messages";
import type { ColorRgbCustom } from "@/types/color";

export type NewCustomColorDraft = {
  r: string;
  g: string;
  b: string;
  block: string;
};

type PanelCustomColorsProps = {
  customColors: ColorRgbCustom[];
  setCustomColors: Dispatch<SetStateAction<ColorRgbCustom[]>>;
  customMode: "custom" | number;
  setCustomMode: Dispatch<SetStateAction<"custom" | number>>;
  newCustom: NewCustomColorDraft;
  setNewCustom: Dispatch<SetStateAction<NewCustomColorDraft>>;
  addCustomColor: () => void;
};

export function PanelCustomColors({
  customColors,
  setCustomColors,
  customMode,
  setCustomMode,
  newCustom,
  setNewCustom,
  addCustomColor,
}: PanelCustomColorsProps) {
  return (
    <section className="bg-card border border-border rounded-md p-2">
      <div className="flex items-center gap-1 mb-1">
        <h2
          className="text-sm font-semibold text-accent cursor-help"
          title={messages.customColors.tooltip}
          aria-label={messages.customColors.ariaLabel}
        >
          {messages.customColors.title}
        </h2>
      </div>
      {customColors.length > 0 && (
        <div className="space-y-0.5 mb-2">
          {customColors.map((customColor, index) => (
            <div key={index} className="flex items-center gap-1.5 text-xs">
              <div
                className="w-4 h-4 rounded border border-border flex-shrink-0"
                style={{ backgroundColor: `rgb(${customColor.r},${customColor.g},${customColor.b})` }}
              />
              <span className="font-mono text-[10px]">
                ({customColor.r},{customColor.g},{customColor.b})
              </span>
              <span className="font-mono text-[10px] text-primary">→ {customColor.blocks.join(" | ")}</span>
              <button
                className="text-destructive text-[10px] hover:underline"
                onClick={() => setCustomColors(prev => prev.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 items-center">
        <select
          className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground w-48"
          value={customMode === "custom" ? "custom" : String(customMode)}
          onChange={e => setCustomMode(e.target.value === "custom" ? "custom" : parseInt(e.target.value))}
        >
          <option value="custom">{messages.customColors.customRgbOption}</option>
          {BASE_COLORS.map((_, idx) => (
            <option key={idx} value={idx}>
              {idx} – {BASE_COLORS[idx].name}
            </option>
          ))}
        </select>
        {customMode === "custom" && (
          <>
            {(["r", "g", "b"] as const).map(channel => (
              <div key={channel} className="flex items-center gap-0.5">
                <label className="text-[10px] text-muted-foreground">{messages.customColors.channelLabel(channel)}</label>
                <input
                  className="w-10 h-6 text-[11px] font-mono no-spinner px-1 bg-input border border-border rounded"
                  type="number"
                  min={0}
                  max={255}
                  value={newCustom[channel]}
                  onChange={e => setNewCustom(prev => ({ ...prev, [channel]: e.target.value }))}
                />
              </div>
            ))}
          </>
        )}
        <div className="flex items-center gap-0.5">
          <label className="text-[10px] text-muted-foreground">{messages.customColors.blockLabel}</label>
          <input
            className="w-40 h-6 text-[11px] font-mono px-1 bg-input border border-border rounded"
            placeholder={messages.customColors.blockPlaceholder}
            value={newCustom.block}
            onChange={e => setNewCustom(prev => ({ ...prev, block: e.target.value }))}
          />
        </div>
        <button
          className="h-6 px-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
          onClick={addCustomColor}
        >
          {messages.common.add}
        </button>
      </div>
    </section>
  );
}
