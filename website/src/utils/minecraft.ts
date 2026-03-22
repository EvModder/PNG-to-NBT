/**
 * Public API:
 * - formatStacks()
 *
 * Callers:
 * - src/Index.tsx
 */

// Callers:
// - src/Index.tsx
export function formatStacks(count: number): string {
  if (count < 64) return String(count);
  const shulkerBoxes = Math.floor(count / (64 * 27));
  const remainder = count % (64 * 27);
  const stacks = Math.floor(remainder / 64);
  const items = remainder % 64;
  return [shulkerBoxes && `${shulkerBoxes}sb`, stacks && `${stacks}st`, items && String(items)].filter(Boolean).join(" ") || "0";
}
