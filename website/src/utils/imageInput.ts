/**
 * Public API:
 * - getClipboardImageFile()
 *
 * Callers:
 * - src/Index.tsx
 */

// Callers:
// - src/Index.tsx
export function getClipboardImageFile(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null;

  const toNamedImageFile = (file: File): File => {
    if (file.name) return file;
    const subtype = file.type.split("/")[1]?.split("+")[0] || "png";
    const extension = subtype === "jpeg" ? "jpg" : subtype;
    return new File([file], `pasted-image.${extension}`, {
      type: file.type,
      lastModified: Date.now(),
    });
  };

  for (const item of clipboardData.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return toNamedImageFile(file);
  }

  for (const file of clipboardData.files) {
    if (file.type.startsWith("image/")) return toNamedImageFile(file);
  }

  return null;
}
