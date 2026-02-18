import Index from "./Index";
import { useEffect } from "react";

function applyTheme() {
  const stored = localStorage.getItem("mapart_theme");
  if (stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

const App = () => {
  useEffect(() => {
    applyTheme();
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => { if (!localStorage.getItem("mapart_theme")) applyTheme(); };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return <Index />;
};

export default App;
