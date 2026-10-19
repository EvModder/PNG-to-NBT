import { createRoot } from "react-dom/client";
import Index from "./Index.tsx";
import "./index.css";

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
  createRoot(document.getElementById("root")!).render(<Index />);
}
