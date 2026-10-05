/**
 * Public API:
 * - PresetFallbackDialog()
 * Callers:
 * - src/Index.tsx
 */
import { Fragment, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { PackedBlockIcon } from "@/components/PackedBlockIcon";
import { getBlockIconAsset } from "@/lib/blockIconAtlas";
import { messages } from "@/lib/messages";
import { getBlockFallbackVersion } from "@/lib/minecraftVersion";
import { MUTED_SQUARE_ICON_BUTTON_CLASS } from "@/utils/uiButtons";
import { PANEL_TITLE_TEXT_CLASS } from "@/utils/uiTypography";

type PresetFallbackDialogProps = {
  preferred: string;
  block: string;
  colorId: number;
  onClose: () => void;
  onSelect: (action: "fallback" | "replace") => void;
};

export function PresetFallbackDialog({ preferred, block, colorId, onClose, onSelect }: PresetFallbackDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const behaviorId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const fallbackVersion = getBlockFallbackVersion(preferred, colorId);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto bg-card text-xs text-foreground border border-border rounded-md p-2 shadow-lg backdrop:bg-black/50">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 id={titleId} className={PANEL_TITLE_TEXT_CLASS}>{messages.presets.fallbackTitle}</h2>
        <button type="button" className={MUTED_SQUARE_ICON_BUTTON_CLASS}
          title={messages.common.close} aria-label={messages.common.close} autoFocus onClick={onClose}>
          <X size={14} strokeWidth={2.1} />
        </button>
      </div>
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-2 gap-y-1 mb-2">
        {[[messages.presets.fallbackPrevious, preferred], [messages.presets.fallbackSelected, block]].map(([label, name]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <span aria-hidden="true" className="shrink-0 w-5 h-5 rounded border border-border overflow-hidden">
                <PackedBlockIcon {...getBlockIconAsset(name)} alt={name} className="w-full h-full" />
              </span>
              <code className="min-w-0 break-words text-[11px]">{name}</code>
            </dd>
          </Fragment>
        ))}
      </dl>
      <div role="group" aria-labelledby={behaviorId}
        className="flex flex-wrap items-center gap-2 border-t border-border pt-2 [&_button]:rounded [&_button]:border [&_button]:border-border [&_button]:px-2 [&_button]:py-1 [&_button:hover]:bg-muted">
        <span id={behaviorId}>{messages.presets.fallbackQuestion}</span>
        <button type="button" onClick={() => onSelect("replace")}>{messages.presets.fallbackReplace}</button>
        {fallbackVersion && (
          <button type="button" onClick={() => onSelect("fallback")}>
            {messages.presets.fallbackKeep(fallbackVersion.operator, fallbackVersion.version)}
          </button>
        )}
      </div>
    </dialog>
  );
}
