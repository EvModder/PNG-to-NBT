import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import Index from "./Index.tsx";
import "./index.css";

const readStoredTheme = (): "light" | "dark" | null => {
  const raw = localStorage.getItem("mapart_theme");
  if (raw === "light" || raw === "dark") return raw;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed === "light" || parsed === "dark" ? parsed : null;
  } catch {
    return null;
  }
};

function applyTheme() {
  const stored = readStoredTheme();
  const isDark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", isDark);
}

function App() {
  useEffect(() => {
    applyTheme();
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (!readStoredTheme()) applyTheme();
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return <Index />;
}

function canonicalizeTrailingSlash(): boolean {
  const { pathname, search, hash } = window.location;
  const trimmedPath = pathname.replace(/\/+$/, "");
  const canonicalPath = `${trimmedPath}/` || "/";
  if (canonicalPath !== pathname) {
    window.location.replace(`${canonicalPath}${search}${hash}`);
    return true;
  }
  return false;
}

if (!canonicalizeTrailingSlash()) {
  createRoot(document.getElementById("root")!).render(<App />);
}
