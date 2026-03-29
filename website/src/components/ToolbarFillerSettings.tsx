import { Fragment, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import {
  DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK,
  DEFAULT_SHADE_FILLER_BLOCK,
  DEFAULT_SUPPORT_FILLER_BLOCK,
  DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK,
} from "@/data/defaultSettings";
import { messages } from "@/lib/messages";

type FillerFieldProps = {
  label: string;
  tooltip: string;
  value: string;
  setValue: (value: string) => void;
  placeholder: string;
  showRequiredBadge: boolean;
  requiredTooltip: string;
  requiredCountLabel: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export type ToolbarFillerSettingsProps = {
  toolbarRef: MutableRefObject<HTMLElement | null>;
  isStackedLayout: boolean;
  hasImageData: boolean;
  showSupportFillerInput: boolean;
  supportFillerBlock: string;
  setSupportFillerBlock: (value: string) => void;
  commitSupportFillerBlock: (value: string) => void;
  supportFillerDisabled: boolean;
  supportFillerRequiredCount: number;
  showShadeFillerInput: boolean;
  shadeFillerBlock: string;
  setShadeFillerBlock: (value: string) => void;
  shadeFillerIsNorthRowOnly: boolean;
  shadeFillerShadingDisabled: boolean;
  shadeFillerRequiredCount: number;
  showDominateVoidFillerInput: boolean;
  dominateVoidFillerBlock: string;
  setDominateVoidFillerBlock: (value: string) => void;
  dominateVoidFillerShadingDisabled: boolean;
  dominateVoidFillerRequiredCount: number;
  showRecessiveVoidFillerInput: boolean;
  recessiveVoidFillerBlock: string;
  setRecessiveVoidFillerBlock: (value: string) => void;
  recessiveVoidFillerShadingDisabled: boolean;
  recessiveVoidFillerRequiredCount: number;
  showLateFillerInput: boolean;
  suppress2LayerLateFillerBlock: string;
  setSuppress2LayerLateFillerBlock: (value: string) => void;
  lateFillerShadingDisabled: boolean;
  lateFillerRequiredCount: number;
  formatRequiredCount: (count: number) => ReactNode;
};

function FillerField({
  label,
  tooltip,
  value,
  setValue,
  placeholder,
  showRequiredBadge,
  requiredTooltip,
  requiredCountLabel,
  onKeyDown,
}: FillerFieldProps) {
  return (
    <div className="inline-flex items-center gap-1 shrink-0">
      <span
        className="text-xs font-semibold text-accent whitespace-nowrap cursor-help"
        title={tooltip}
      >
        {label}
      </span>
      <div className="inline-flex items-center gap-0 shrink-0">
        <input
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          title={tooltip}
          className="max-w-[101px] h-6 text-xs font-mono px-1.5 bg-input border border-border rounded"
        />
        {showRequiredBadge && (
          <>
            <span className="-mx-px w-2 h-px bg-primary/60 self-center shrink-0" />
            <span
              className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1 border-2 border-primary/60 bg-primary/10 rounded px-1.5 h-6"
              title={requiredTooltip}
            >
              <span className="font-semibold">{messages.common.requiredBadge}</span>
              <span className="text-foreground">{requiredCountLabel}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}

export function ToolbarFillerSettings({
  toolbarRef,
  isStackedLayout,
  hasImageData,
  showSupportFillerInput,
  supportFillerBlock,
  setSupportFillerBlock,
  commitSupportFillerBlock,
  supportFillerDisabled,
  supportFillerRequiredCount,
  showShadeFillerInput,
  shadeFillerBlock,
  setShadeFillerBlock,
  shadeFillerIsNorthRowOnly,
  shadeFillerShadingDisabled,
  shadeFillerRequiredCount,
  showDominateVoidFillerInput,
  dominateVoidFillerBlock,
  setDominateVoidFillerBlock,
  dominateVoidFillerShadingDisabled,
  dominateVoidFillerRequiredCount,
  showRecessiveVoidFillerInput,
  recessiveVoidFillerBlock,
  setRecessiveVoidFillerBlock,
  recessiveVoidFillerShadingDisabled,
  recessiveVoidFillerRequiredCount,
  showLateFillerInput,
  suppress2LayerLateFillerBlock,
  setSuppress2LayerLateFillerBlock,
  lateFillerShadingDisabled,
  lateFillerRequiredCount,
  formatRequiredCount,
}: ToolbarFillerSettingsProps) {
  const groups: { key: string; node: ReactNode }[] = [];
  const shadeFillerLabel = messages.fillers.shadeLabel(shadeFillerIsNorthRowOnly);
  const shadeFillerTooltip = messages.fillers.shadeTooltip(shadeFillerIsNorthRowOnly);
  const shadeFillerRequiredTooltip = messages.fillers.shadeRequiredTooltip(shadeFillerIsNorthRowOnly);

  if (showSupportFillerInput) {
    groups.push({
      key: "support",
      node: (
        <FillerField
          label={messages.fillers.supportLabel}
          tooltip={messages.fillers.supportTooltip}
          value={supportFillerBlock}
          setValue={setSupportFillerBlock}
          placeholder={DEFAULT_SUPPORT_FILLER_BLOCK}
          showRequiredBadge={hasImageData && !supportFillerDisabled && supportFillerRequiredCount > 0}
          requiredTooltip={messages.fillers.supportRequiredTooltip}
          requiredCountLabel={formatRequiredCount(supportFillerRequiredCount)}
          onKeyDown={e => {
            if (e.key === "Enter") commitSupportFillerBlock(e.currentTarget.value);
          }}
        />
      ),
    });
  }

  if (showShadeFillerInput) {
    groups.push({
      key: "shade",
      node: (
        <FillerField
          label={shadeFillerLabel}
          tooltip={shadeFillerTooltip}
          value={shadeFillerBlock}
          setValue={setShadeFillerBlock}
          placeholder={DEFAULT_SHADE_FILLER_BLOCK}
          showRequiredBadge={hasImageData && !shadeFillerShadingDisabled && shadeFillerRequiredCount > 0}
          requiredTooltip={shadeFillerRequiredTooltip}
          requiredCountLabel={formatRequiredCount(shadeFillerRequiredCount)}
        />
      ),
    });
  }

  if (showDominateVoidFillerInput) {
    groups.push({
      key: "dominate-void",
      node: (
        <FillerField
          label={messages.fillers.dominateVoidLabel}
          tooltip={messages.fillers.dominateVoidTooltip}
          value={dominateVoidFillerBlock}
          setValue={setDominateVoidFillerBlock}
          placeholder={DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK}
          showRequiredBadge={hasImageData && !dominateVoidFillerShadingDisabled && dominateVoidFillerRequiredCount > 0}
          requiredTooltip={messages.fillers.dominateVoidRequiredTooltip}
          requiredCountLabel={formatRequiredCount(dominateVoidFillerRequiredCount)}
        />
      ),
    });
  }

  if (showRecessiveVoidFillerInput) {
    groups.push({
      key: "recessive-void",
      node: (
        <FillerField
          label={messages.fillers.recessiveVoidLabel}
          tooltip={messages.fillers.recessiveVoidTooltip}
          value={recessiveVoidFillerBlock}
          setValue={setRecessiveVoidFillerBlock}
          placeholder={DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK}
          showRequiredBadge={hasImageData && !recessiveVoidFillerShadingDisabled && recessiveVoidFillerRequiredCount > 0}
          requiredTooltip={messages.fillers.recessiveVoidRequiredTooltip}
          requiredCountLabel={formatRequiredCount(recessiveVoidFillerRequiredCount)}
        />
      ),
    });
  }

  if (showLateFillerInput) {
    groups.push({
      key: "late",
      node: (
        <FillerField
          label={messages.fillers.lateLabel}
          tooltip={messages.fillers.lateTooltip}
          value={suppress2LayerLateFillerBlock}
          setValue={setSuppress2LayerLateFillerBlock}
          placeholder={DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK}
          showRequiredBadge={hasImageData && !lateFillerShadingDisabled && lateFillerRequiredCount > 0}
          requiredTooltip={messages.fillers.lateRequiredTooltip}
          requiredCountLabel={formatRequiredCount(lateFillerRequiredCount)}
        />
      ),
    });
  }

  if (!groups.length) return null;

  return (
    <section
      ref={toolbarRef}
      className={`bg-card border border-border rounded-md p-1.5 flex items-center gap-1.5 ${
        isStackedLayout ? "flex-wrap" : "flex-nowrap"
      }`}
    >
      {groups.map((group, index) => (
        <Fragment key={group.key}>
          {index > 0 && <span className="h-4 border-l border-border/70" />}
          {group.node}
        </Fragment>
      ))}
    </section>
  );
}
