/**
 * Public API:
 * - primePreviewImageRoute()
 * - startPreviewImageSession()
 *
 * Callers:
 * - src/Index.tsx
 * - src/main.tsx
 *
 * Stores generated preview PNGs under same-origin hash-based URLs so browsers can open/save them as normal images.
 */
import { md5 } from "./md5";
import { MAP_SIZE, type ColorGrid } from "./colorGridTypes";

const PREVIEW_IMAGE_CACHE_NAME = "mapart-preview-images-v1";
const PREVIEW_SW_RELOAD_KEY = "mapart_preview_sw_reload_once";

type PreviewImageSessionOptions = {
  imageData: ImageData;
  colorGrid: ColorGrid | null;
  onPreviewUrl: (url: string | null) => void;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

function formatUuid32(hex32: string): string {
  const hex = hex32.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function nameUuidFromBytes(bytes: Uint8Array): string {
  const hash = md5(bytes);
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return formatUuid32(bytesToHex(hash));
}

function colorGridToHashBytes(colorGrid: ColorGrid): Uint8Array {
  let canUseMapBytes = true;
  outer: for (let x = 0; x < MAP_SIZE; ++x) {
    for (let z = 0; z < MAP_SIZE; ++z) {
      const color = colorGrid[x][z];
      if (color.isCustom || color.id < 0 || color.id > 63) {
        canUseMapBytes = false;
        break outer;
      }
    }
  }

  if (canUseMapBytes) {
    const bytes = new Uint8Array(MAP_SIZE * MAP_SIZE);
    for (let z = 0; z < MAP_SIZE; ++z) {
      for (let x = 0; x < MAP_SIZE; ++x) {
        const color = colorGrid[x][z];
        bytes[z * MAP_SIZE + x] = color.id * 4 + color.shade;
      }
    }
    return bytes;
  }

  const bytes = new Uint8Array(MAP_SIZE * MAP_SIZE * 4);
  let offset = 0;
  for (let z = 0; z < MAP_SIZE; ++z) {
    for (let x = 0; x < MAP_SIZE; ++x) {
      const color = colorGrid[x][z];
      bytes[offset++] = color.isCustom ? 1 : 0;
      bytes[offset++] = color.id & 0xff;
      bytes[offset++] = (color.id >>> 8) & 0xff;
      bytes[offset++] = color.shade;
    }
  }
  return bytes;
}

function getPreviewImageUrl(uuid: string): string {
  return new URL(`${uuid}.png`, window.location.href).toString();
}

let serviceWorkerReadyPromise: Promise<ServiceWorkerRegistration | null> | null = null;
async function ensurePreviewServiceWorkerReady(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  if (!serviceWorkerReadyPromise) {
    const scope = new URL("./", window.location.href).toString();
    const serviceWorkerUrl = new URL("preview-sw.js", scope).toString();
    serviceWorkerReadyPromise = navigator.serviceWorker
      .register(serviceWorkerUrl, { scope })
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return serviceWorkerReadyPromise;
}

export function primePreviewImageRoute(): void {
  void (async () => {
    const registration = await ensurePreviewServiceWorkerReady();
    if (!registration) return;
    if (navigator.serviceWorker.controller) {
      sessionStorage.removeItem(PREVIEW_SW_RELOAD_KEY);
      return;
    }
    if (sessionStorage.getItem(PREVIEW_SW_RELOAD_KEY) === "1") return;
    sessionStorage.setItem(PREVIEW_SW_RELOAD_KEY, "1");
    window.location.reload();
  })();
}

export async function storePreviewImage(
  colorGrid: ColorGrid,
  pngBlob: Blob,
): Promise<string | null> {
  const uuid = nameUuidFromBytes(colorGridToHashBytes(colorGrid));
  const previewUrl = getPreviewImageUrl(uuid);

  const registration = await ensurePreviewServiceWorkerReady();
  if (!registration || !("caches" in window)) {
    return null;
  }

  const cache = await caches.open(PREVIEW_IMAGE_CACHE_NAME);
  const headers = new Headers({
    "Content-Type": "image/png",
    "Content-Disposition": `inline; filename="${uuid}.png"`,
    "Cache-Control": "no-store",
  });
  await cache.put(previewUrl, new Response(pngBlob, { headers }));
  return previewUrl;
}

function createPreviewCanvas(imageData: ImageData): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function waitForPreviewImageRouteControl(onReady: () => void): () => void {
  if (!("serviceWorker" in navigator) || navigator.serviceWorker.controller) {
    onReady();
    return () => {};
  }

  const onControllerChange = () => {
    if (!navigator.serviceWorker.controller) return;
    navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    onReady();
  };

  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
}

export function startPreviewImageSession(
  { imageData, colorGrid, onPreviewUrl }: PreviewImageSessionOptions,
): () => void {
  const canvas = createPreviewCanvas(imageData);
  if (!canvas) {
    onPreviewUrl(null);
    return () => {};
  }

  let cancelled = false;
  let currentUrl: string | null = null;
  let removeControllerChangeListener: (() => void) | null = null;

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
    if (!colorGrid) return;

    void (async () => {
      const nextUrl = await storePreviewImage(colorGrid, blob);
      if (!nextUrl || cancelled) return;

      removeControllerChangeListener = waitForPreviewImageRouteControl(() => {
        removeControllerChangeListener = null;
        if (!cancelled) updatePreviewUrl(nextUrl);
      });
    })();
  }, "image/png");

  return () => {
    cancelled = true;
    removeControllerChangeListener?.();
    if (currentUrl?.startsWith("blob:")) URL.revokeObjectURL(currentUrl);
  };
}
