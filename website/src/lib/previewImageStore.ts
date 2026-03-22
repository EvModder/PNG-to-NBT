/**
 * Public API:
 * - usePreviewImageUrl()
 *
 * Callers:
 * - src/Index.tsx
 */
import { useEffect, useState } from "react";
import type { PreviewPixelReplacement } from "./previewImageEdits";

type PreviewImageSessionOptions = {
  imageData: ImageData;
  pixelReplacements?: readonly PreviewPixelReplacement[];
  onPreviewUrl: (url: string | null) => void;
};

type UsePreviewImageUrlOptions = {
  imageData: ImageData | null;
  pixelReplacements?: readonly PreviewPixelReplacement[];
};

function createPreviewCanvas(
  imageData: ImageData,
  pixelReplacements: readonly PreviewPixelReplacement[] = [],
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const previewImageData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  for (const { x, z, r, g, b } of pixelReplacements) {
    if (x < 0 || x >= previewImageData.width || z < 0 || z >= previewImageData.height) continue;
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
  { imageData, pixelReplacements, onPreviewUrl }: PreviewImageSessionOptions,
): () => void {
  const canvas = createPreviewCanvas(imageData, pixelReplacements);
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
  { imageData, pixelReplacements }: UsePreviewImageUrlOptions,
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
      onPreviewUrl: setPreviewImageUrl,
    });
  }, [imageData, pixelReplacements]);

  return previewImageUrl;
}
