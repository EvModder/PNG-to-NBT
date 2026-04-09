/**
 * Public API:
 * - PanelCredits()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { RefObject } from "react";
import { messages } from "@/lib/messages";
import { ACCENT_SMALL_LABEL_TEXT_CLASS } from "@/utils/uiTypography";

type PanelCreditsProps = {
  creditsRef: RefObject<HTMLDivElement | null>;
  isStackedLayout: boolean;
  creditsFloatGapPx: number;
};

// Callers:
// - src/Index.tsx
export function PanelCredits({
  creditsRef,
  isStackedLayout,
  creditsFloatGapPx,
}: PanelCreditsProps) {
  const [rebaneRolePrefix, rebaneRoleSuffix] = messages.credits.rebaneRoleParts();

  return (
    <div
      ref={creditsRef}
      className={`${isStackedLayout ? "order-4" : ""} text-[11px] text-muted-foreground text-left space-y-0.5 px-1 pt-4`}
      style={creditsFloatGapPx > 0 ? { transform: `translateY(${creditsFloatGapPx}px)` } : undefined}
    >
      <h3 className={`${ACCENT_SMALL_LABEL_TEXT_CLASS} mb-1`}>{messages.credits.title}</h3>
      <p>
        <a
          href={messages.credits.evModderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          {messages.credits.evModderName}
        </a>{" "}
        — {messages.credits.evModderRole}
      </p>
      <p>
        <a
          href={messages.credits.rebaneUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          {messages.credits.rebaneName}
        </a>{" "}
        — {rebaneRolePrefix}
        <a
          href={messages.credits.mapArtCraftUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          {messages.credits.mapArtCraftName}
        </a>
        {rebaneRoleSuffix}
      </p>
      <p>
        <a
          href={messages.credits.gu2t4vUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          {messages.credits.gu2t4vName}
        </a>{" "}
        — {messages.credits.gu2t4vRole}
      </p>
      <p>{messages.credits.gptNote}</p>
    </div>
  );
}
