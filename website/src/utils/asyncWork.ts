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
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      const timeoutId = setTimeout(settle, 32);
      window.requestAnimationFrame(() => {
        clearTimeout(timeoutId);
        settle();
      });
      return;
    }
    setTimeout(settle, 0);
  });
}
