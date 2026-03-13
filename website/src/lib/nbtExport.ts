/**
 * Public API:
 * - convertToNbt()
 *
 * Callers:
 * - src/Index.tsx
 */
import type { GeneratedShape } from "./shapeGeneration";
import { type BlockEntry, gzipCompress, writeStructureNbt } from "./nbtWriter";
import { materializeShapeParts, normalizeAndMeasure, type SubstitutionOptions } from "./shapeSubstitution";
import { createZip } from "./zip";

interface ExportOptions extends SubstitutionOptions {
  baseName: string;
}

async function buildSplitZip(
  parts: BlockEntry[][],
  options: ExportOptions,
  names: [string, string],
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const toNbt = async (blocks: BlockEntry[]) => {
    const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
    return gzipCompress(writeStructureNbt(blocks, sizeX, sizeY, sizeZ));
  };

  const [firstData, secondData] = await Promise.all([toNbt(parts[0] ?? []), toNbt(parts[1] ?? [])]);
  const zipEntries = [
    { name: `${options.baseName}-${names[0]}.nbt`, data: firstData },
    { name: `${options.baseName}-${names[1]}.nbt`, data: secondData },
  ];
  return { data: createZip(zipEntries), isZip: true };
}

// Callers:
// - src/Index.tsx
export async function convertToNbt(
  shape: GeneratedShape,
  options: ExportOptions,
): Promise<{ data: Uint8Array; isZip: boolean }> {
  const parts = materializeShapeParts(shape, options);
  if (shape.splitExportNames) return buildSplitZip(parts, options, shape.splitExportNames);

  const blocks = parts.flat();
  const { sizeX, sizeY, sizeZ } = normalizeAndMeasure(blocks, options.forceZ129 === true);
  return { data: await gzipCompress(writeStructureNbt(blocks, sizeX, sizeY, sizeZ)), isZip: false };
}
