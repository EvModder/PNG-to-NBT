/**
 * Public API:
 * - PreviewCanvas()
 * Callers:
 * - src/components/PanelImagePreview.tsx
 */
import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import type { PreviewPixelMask, PreviewPixelReplacement } from "@/lib/previewImageEdits";
import { MAP_SIZE } from "@/utils/color";

type PreviewCanvasProps = ComponentPropsWithoutRef<"canvas"> & {
  imageData: ImageData;
  pixelReplacements: readonly PreviewPixelReplacement[];
  visiblePixelMask: PreviewPixelMask | null;
  selectedTileIndices?: ReadonlySet<number>;
};

// Unselected tiles are display-only context beneath the natively saved canvas.
export function PreviewCanvas({ imageData, pixelReplacements, visiblePixelMask, selectedTileIndices, ...props }: PreviewCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<HTMLCanvasElement>(null);
  const tileCols = Math.ceil(imageData.width / MAP_SIZE);
  const tileCount = tileCols * Math.ceil(imageData.height / MAP_SIZE);
  const showContext = !!selectedTileIndices?.size && selectedTileIndices.size < tileCount;
  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const pixels = visiblePixelMask || pixelReplacements.length
      ? new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height)
      : imageData;
    for (const { x, z, r, g, b } of pixelReplacements) {
      if (x < 0 || z < 0 || x >= pixels.width || z >= pixels.height) continue;
      const index = z * pixels.width + x;
      pixels.data.set([r, g, b, 255], index * 4);
    }
    const context = contextRef.current;
    const contextCtx = context?.getContext("2d");
    if (context && contextCtx) {
      context.width = imageData.width;
      context.height = imageData.height;
      for (let index = 0; index < tileCount; ++index) {
        if (selectedTileIndices?.has(index)) continue;
        contextCtx.putImageData(pixels, 0, 0, index % tileCols * MAP_SIZE, Math.floor(index / tileCols) * MAP_SIZE, MAP_SIZE, MAP_SIZE);
      }
    }
    if (visiblePixelMask) {
      for (let i = 0; i < visiblePixelMask.length; ++i) {
        if (!visiblePixelMask[i]) pixels.data.fill(0, i * 4, i * 4 + 4);
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }, [imageData, pixelReplacements, visiblePixelMask, selectedTileIndices, tileCols, tileCount]);

  return <>
    {showContext && <canvas ref={contextRef} aria-hidden="true" className={props.className} style={{ ...props.style, pointerEvents: "none" }} />}
    <canvas {...props} ref={ref} />
  </>;
}
