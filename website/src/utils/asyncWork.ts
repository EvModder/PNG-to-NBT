/**
 * Public API:
 * - yieldToMainThread()
 *
 * Callers:
 * - src/Index.tsx
 */

// Callers:
// - src/Index.tsx
export function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}
