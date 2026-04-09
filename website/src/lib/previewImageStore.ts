/**
 * Public API:
 * - usePreviewImageUrl()
 *
 * Callers:
 * - src/Index.tsx
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { PreviewPixelMask, PreviewPixelReplacement } from "./previewImageEdits";

type PreviewImageSessionOptions = {
  imageData: ImageData;
  pixelReplacements?: readonly PreviewPixelReplacement[];
  visiblePixelMask?: PreviewPixelMask | null;
  onPreviewUrl: (url: string | null) => void;
};

type UsePreviewImageUrlOptions = {
  enabled?: boolean;
  imageData: ImageData | null;
  pixelReplacements?: readonly PreviewPixelReplacement[];
  visiblePixelMask?: PreviewPixelMask | null;
};

type PreviewImageRequest = {
  key: string;
  imageData: ImageData;
  pixelReplacements?: readonly PreviewPixelReplacement[];
  visiblePixelMask?: PreviewPixelMask;
};

const objectIdCache = new WeakMap<object, number>();
let nextObjectId = 1;

function getObjectId(value: object): number {
  const cached = objectIdCache.get(value);
  if (cached !== undefined) return cached;
  const id = nextObjectId++;
  objectIdCache.set(value, id);
  return id;
}

function getPixelReplacementSignature(
  pixelReplacements?: readonly PreviewPixelReplacement[],
): string {
  if (!pixelReplacements || pixelReplacements.length === 0) return "";
  return pixelReplacements
    .map(({ x, z, r, g, b }) => `${x},${z},${r},${g},${b}`)
    .join(";");
}

function isPreviewPixelVisible(
  x: number,
  z: number,
  width: number,
  visiblePixelMask?: PreviewPixelMask | null,
): boolean {
  if (visiblePixelMask && visiblePixelMask[z * width + x] === 0) return false;
  return true;
}

function createPreviewCanvas(
  imageData: ImageData,
  pixelReplacements: readonly PreviewPixelReplacement[] = [],
  visiblePixelMask?: PreviewPixelMask | null,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const previewImageData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  if (visiblePixelMask) {
    for (let z = 0; z < previewImageData.height; ++z) {
      for (let x = 0; x < previewImageData.width; ++x) {
        if (isPreviewPixelVisible(x, z, previewImageData.width, visiblePixelMask)) continue;
        previewImageData.data[(z * previewImageData.width + x) * 4 + 3] = 0;
      }
    }
  }
  for (const { x, z, r, g, b } of pixelReplacements) {
    if (x < 0 || x >= previewImageData.width || z < 0 || z >= previewImageData.height) continue;
    if (!isPreviewPixelVisible(x, z, previewImageData.width, visiblePixelMask)) continue;
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
  { imageData, pixelReplacements, visiblePixelMask, onPreviewUrl }: PreviewImageSessionOptions,
): () => void {
  const canvas = createPreviewCanvas(imageData, pixelReplacements, visiblePixelMask);
  if (!canvas) {
    onPreviewUrl(null);
    return () => {};
  }
  let objectUrl: string | null = null;
  let cancelled = false;
  canvas.toBlob(blob => {
    if (cancelled) return;
    if (!blob) {
      onPreviewUrl(null);
      return;
    }
    objectUrl = URL.createObjectURL(blob);
    onPreviewUrl(objectUrl);
  }, "image/png");
  return () => {
    cancelled = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}

// Callers:
// - src/Index.tsx
export function usePreviewImageUrl(
  { enabled = true, imageData, pixelReplacements, visiblePixelMask }: UsePreviewImageUrlOptions,
): string | null {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const activePixelReplacements = pixelReplacements && pixelReplacements.length > 0 ? pixelReplacements : undefined;
  const activeVisiblePixelMask = visiblePixelMask ?? undefined;
  const request = useMemo<PreviewImageRequest | null>(
    () => {
      if (!enabled || !imageData) return null;
      return {
        key: [
          getObjectId(imageData),
          getPixelReplacementSignature(activePixelReplacements),
          activeVisiblePixelMask ? getObjectId(activeVisiblePixelMask) : "",
        ].join("|"),
        imageData,
        pixelReplacements: activePixelReplacements,
        visiblePixelMask: activeVisiblePixelMask,
      };
    },
    [
      enabled,
      imageData,
      activePixelReplacements,
      activeVisiblePixelMask,
    ],
  );
  const requestRef = useRef<PreviewImageRequest | null>(request);
  requestRef.current = request;

  useEffect(() => {
    const activeRequest = requestRef.current;
    if (!activeRequest) {
      setPreviewImageUrl(null);
      return;
    }
    return startPreviewImageSession({
      imageData: activeRequest.imageData,
      pixelReplacements: activeRequest.pixelReplacements,
      visiblePixelMask: activeRequest.visiblePixelMask,
      onPreviewUrl: setPreviewImageUrl,
    });
  }, [request?.key]);

  return previewImageUrl;
}
