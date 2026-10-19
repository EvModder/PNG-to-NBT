/**
 * Public API:
 * - getDarkTheme()
 * - toggleTheme()
 * - observeTheme()
 *
 * Callers: src/Index.tsx
 */
import { STORAGE_KEYS } from "@/data/storageKeys";

const systemThemeQuery = "(prefers-color-scheme: dark)";

export function getDarkTheme(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.theme);
    const stored = raw === "light" || raw === "dark" ? raw : JSON.parse(raw ?? "null");
    if (stored === "light" || stored === "dark") return stored === "dark";
  } catch { /* Unavailable storage or invalid preferences fall back to the system. */ }
  return matchMedia(systemThemeQuery).matches;
}

function applyTheme(dark: boolean): boolean {
  document.documentElement.classList.toggle("dark", dark);
  return dark;
}

export function toggleTheme(): boolean {
  const dark = !document.documentElement.classList.contains("dark");
  try {
    if (dark === matchMedia(systemThemeQuery).matches) localStorage.removeItem(STORAGE_KEYS.theme);
    else localStorage.setItem(STORAGE_KEYS.theme, dark ? "dark" : "light");
  } catch { /* The toggle still works for this page when storage is unavailable. */ }
  return applyTheme(dark);
}

export function observeTheme(onChange?: (dark: boolean) => void): () => void {
  const sync = () => {
    const dark = applyTheme(getDarkTheme());
    onChange?.(dark);
  };
  const onStorage = (event: StorageEvent) => {
    try {
      if (event.storageArea === localStorage && (event.key === STORAGE_KEYS.theme || event.key === null)) sync();
    } catch { /* Storage access may have been revoked since this page opened. */ }
  };
  const system = matchMedia(systemThemeQuery);
  sync();
  system.addEventListener("change", sync);
  window.addEventListener("storage", onStorage);
  return () => {
    system.removeEventListener("change", sync);
    window.removeEventListener("storage", onStorage);
  };
}
