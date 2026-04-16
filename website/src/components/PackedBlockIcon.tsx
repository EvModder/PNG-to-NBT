/**
 * Public API:
 * - PackedBlockIcon()
 *
 * Callers:
 * - src/components/PanelColorBlockTable.tsx
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { messages } from "@/lib/messages";
import { getBlockIconAtlasEntry, renderBlockIconAtlasEntryToCanvas } from "@/lib/blockIconAtlas";
import type { BlockIconAtlasName } from "@/data/blockIconAtlases";

type PackedBlockIconProps = {
  atlasKey: string;
  atlasName: BlockIconAtlasName;
  alt: string;
  className?: string;
};

// Callers:
// - src/components/PanelColorBlockTable.tsx
export function PackedBlockIcon({
  atlasKey,
  atlasName,
  alt,
  className,
}: PackedBlockIconProps) {
  const atlasEntry = useMemo(
    () => getBlockIconAtlasEntry(atlasName, atlasKey),
    [atlasName, atlasKey],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!atlasEntry || !canvas) return;

    setLoadFailed(false);
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    const abortController = new AbortController();

    renderBlockIconAtlasEntryToCanvas(canvas, atlasEntry, abortController.signal).catch(() => {
      if (!abortController.signal.aborted) setLoadFailed(true);
    });

    return () => {
      abortController.abort();
    };
  }, [atlasEntry]);

  if (!atlasEntry || loadFailed) {
    return (
      <span
        className={`inline-flex items-center justify-center text-[9px] text-muted-foreground ${className ?? ""}`}
        role="img"
        aria-label={alt}
      >
        {messages.common.missingTextureSymbol}
      </span>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={atlasEntry.cellSize}
      height={atlasEntry.cellSize}
      className={`block ${className ?? ""}`}
      role="img"
      aria-label={alt}
      style={{ imageRendering: "pixelated" }}
    />
  );
}
