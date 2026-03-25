/**
 * Public API:
 * - usePreviewImageUrl()
 *
 * Callers:
 * - src/Index.tsx
 */
import { useEffect, useState } from "react";
import type { PreviewPixelMask, PreviewPixelReplacement } from "./previewImageEdits";

type PreviewImageSessionOptions = {
  imageData: ImageData;
  pixelReplacements?: readonly PreviewPixelReplacement[];
  xColumnRange?: readonly [number, number];
  visiblePixelMask?: PreviewPixelMask | null;
  onPreviewUrl: (url: string | null) => void;
};

type UsePreviewImageUrlOptions = {
  imageData: ImageData | null;
  pixelReplacements?: readonly PreviewPixelReplacement[];
  xColumnRange?: readonly [number, number];
  visiblePixelMask?: PreviewPixelMask | null;
};

function isPreviewPixelVisible(
  x: number,
  z: number,
  width: number,
  xColumnRange?: readonly [number, number],
  visiblePixelMask?: PreviewPixelMask | null,
): boolean {
  if (xColumnRange && (x < xColumnRange[0] || x > xColumnRange[1])) return false;
  if (visiblePixelMask && visiblePixelMask[z * width + x] === 0) return false;
  return true;
}

function createPreviewCanvas(
  imageData: ImageData,
  pixelReplacements: readonly PreviewPixelReplacement[] = [],
  xColumnRange?: readonly [number, number],
  visiblePixelMask?: PreviewPixelMask | null,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const previewImageData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  if (xColumnRange || visiblePixelMask) {
    for (let z = 0; z < previewImageData.height; ++z) {
      for (let x = 0; x < previewImageData.width; ++x) {
        if (isPreviewPixelVisible(x, z, previewImageData.width, xColumnRange, visiblePixelMask)) continue;
        previewImageData.data[(z * previewImageData.width + x) * 4 + 3] = 0;
      }
    }
  }
  for (const { x, z, r, g, b } of pixelReplacements) {
    if (x < 0 || x >= previewImageData.width || z < 0 || z >= previewImageData.height) continue;
    if (!isPreviewPixelVisible(x, z, previewImageData.width, xColumnRange, visiblePixelMask)) continue;
    const offset = (z * previewImageData.width + x) * 4;
    previewImageData.data[offset] = r;
    previewImageData.data[offset + 1] = g;
    previewImageData.data[offset + 2] = b;
    previewImageData.data[offset + 3] = 255;
  }
  ctx.putImageData(previewImageData, 0, 0);
  return canvas;
}

function startPreviewImageSession(
  { imageData, pixelReplacements, xColumnRange, visiblePixelMask, onPreviewUrl }: PreviewImageSessionOptions,
): () => void {
  const canvas = createPreviewCanvas(imageData, pixelReplacements, xColumnRange, visiblePixelMask);
  if (!canvas) {
    onPreviewUrl(null);
    return () => {};
  }

  let cancelled = false;
  let currentUrl: string | null = null;

  const updatePreviewUrl = (nextUrl: string | null) => {
    if (cancelled) {
      if (nextUrl?.startsWith("blob:")) URL.revokeObjectURL(nextUrl);
      return;
    }
    if (currentUrl?.startsWith("blob:")) URL.revokeObjectURL(currentUrl);
    currentUrl = nextUrl;
    onPreviewUrl(nextUrl);
  };

  canvas.toBlob(blob => {
    if (!blob) return;
    updatePreviewUrl(URL.createObjectURL(blob));
  }, "image/png");

  return () => {
    cancelled = true;
    if (currentUrl?.startsWith("blob:")) URL.revokeObjectURL(currentUrl);
  };
}

// Callers:
// - src/Index.tsx
export function usePreviewImageUrl(
  { imageData, pixelReplacements, xColumnRange, visiblePixelMask }: UsePreviewImageUrlOptions,
): string | null {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageData) {
      setPreviewImageUrl(null);
      return;
    }
    return startPreviewImageSession({
      imageData,
      pixelReplacements,
      xColumnRange,
      visiblePixelMask,
      onPreviewUrl: setPreviewImageUrl,
    });
  }, [imageData, pixelReplacements, xColumnRange, visiblePixelMask]);

  return previewImageUrl;
}
