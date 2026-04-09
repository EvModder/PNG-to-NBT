/**
 * Public API:
 * - toBlockIconKey()
 * - getBlockIconAtlasEntry()
 * - renderBlockIconAtlasEntryToCanvas()
 *
 * Callers:
 * - src/components/PanelColorBlockTable.tsx
 * - src/components/PackedBlockIcon.tsx
 */
import { BLOCK_ICON_ATLASES, type BlockIconAtlasName } from "@/data/blockIconAtlases";
import { stripDefaultBlockNamespace } from "@/lib/blockId";

const atlasImageCache = new Map<string, HTMLImageElement>();
const atlasImageLoadCache = new Map<string, Promise<HTMLImageElement>>();

interface BlockIconAtlasEntry {
  atlasSrc: string;
  cellSize: number;
  offsetX: number;
  offsetY: number;
}

// Callers:
// - src/components/PanelColorBlockTable.tsx
export function toBlockIconKey(raw: string): string {
  return stripDefaultBlockNamespace(raw)
    .replace(/__/g, "__us__")
    .replace(/\[/g, "__lb__")
    .replace(/\]/g, "__rb__")
    .replace(/=/g, "__eq__")
    .replace(/,/g, "__cm__")
    .replace(/:/g, "__cl__");
}

// Callers:
// - src/components/PackedBlockIcon.tsx
export function getBlockIconAtlasEntry(
  atlasName: BlockIconAtlasName,
  iconKey: string,
): BlockIconAtlasEntry | null {
  const atlas = BLOCK_ICON_ATLASES[atlasName];
  const index = atlas.entries[iconKey];
  if (index === undefined) return null;

  const col = index % atlas.columns;
  const row = Math.floor(index / atlas.columns);
  return {
    atlasSrc: atlas.src,
    cellSize: atlas.cellSize,
    offsetX: col * atlas.cellSize,
    offsetY: row * atlas.cellSize,
  };
}

function loadBlockIconAtlasImage(atlasSrc: string): Promise<HTMLImageElement> {
  const cachedImage = atlasImageCache.get(atlasSrc);
  if (cachedImage) return Promise.resolve(cachedImage);

  const cachedLoad = atlasImageLoadCache.get(atlasSrc);
  if (cachedLoad) return cachedLoad;

  const src = `${import.meta.env.BASE_URL}${atlasSrc}`;
  const image = new Image();
  image.decoding = "async";
  image.src = src;

  const loadPromise = new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => {
      atlasImageLoadCache.delete(atlasSrc);
      atlasImageCache.set(atlasSrc, image);
      resolve(image);
    };
    image.onerror = () => {
      atlasImageLoadCache.delete(atlasSrc);
      reject(new Error(`Failed to load atlas image: ${src}`));
    };
  });

  atlasImageLoadCache.set(atlasSrc, loadPromise);
  return loadPromise;
}

function drawBlockIconAtlasImageToCanvas(
  canvas: HTMLCanvasElement,
  atlasImage: CanvasImageSource,
  entry: BlockIconAtlasEntry,
  devicePixelRatio = window.devicePixelRatio || 1,
): void {
  const renderSize = Math.max(1, Math.round(entry.cellSize * devicePixelRatio));
  if (canvas.width !== renderSize || canvas.height !== renderSize) {
    canvas.width = renderSize;
    canvas.height = renderSize;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    atlasImage,
    entry.offsetX,
    entry.offsetY,
    entry.cellSize,
    entry.cellSize,
    0,
    0,
    canvas.width,
    canvas.height,
  );
}

// Callers:
// - src/components/PackedBlockIcon.tsx
export async function renderBlockIconAtlasEntryToCanvas(
  canvas: HTMLCanvasElement,
  entry: BlockIconAtlasEntry,
  signal?: AbortSignal,
): Promise<void> {
  const atlasImage = await loadBlockIconAtlasImage(entry.atlasSrc);
  if (signal?.aborted) return;
  drawBlockIconAtlasImageToCanvas(canvas, atlasImage, entry);
}
