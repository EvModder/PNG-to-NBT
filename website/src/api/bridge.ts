/**
 * Headless cross-origin bridge.
 *
 * Public API:
 * - none
 *
 * Callers:
 * - src/api/bridge.html
 */
import { API_CONNECT, API_PROTOCOL_VERSION, resultTransfers, type ApiRequest, type ApiResponse } from "./protocol";

let connected = false;
window.addEventListener("message", (event: MessageEvent) => {
  if (connected || window.parent === window || event.source !== window.parent || event.origin === "null"
    || event.data?.type !== API_CONNECT || event.ports.length !== 1) return;
  const port = event.ports[0];
  // An outdated cached client fails at once instead of waiting for its connection timeout.
  if (event.data.protocolVersion !== API_PROTOCOL_VERSION) {
    port.postMessage({ type: "error", id: 0, code: "PROTOCOL_MISMATCH", message: "Generator interface version mismatch" } satisfies ApiResponse);
    return;
  }
  connected = true;
  let worker: Worker | undefined;
  let activeId: number | undefined;
  const failWorker = () => {
    worker?.terminate();
    worker = undefined;
    const id = activeId ?? 0;
    activeId = undefined;
    port.postMessage({ type: "error", id, code: "WORKER_FAILED", message: "Generator worker failed to load or execute" } satisfies ApiResponse);
  };
  const startWorker = () => {
    const current = new Worker(new URL("./generateTile.worker.ts", import.meta.url), { type: "module" });
    worker = current;
    current.onmessage = (reply: MessageEvent<ApiResponse>) => {
      if (worker !== current) return;
      if (reply.data.type !== "ready") activeId = undefined;
      port.postMessage(reply.data, resultTransfers(reply.data));
    };
    current.onerror = event => {
      event.preventDefault();
      if (worker !== current) return;
      failWorker();
    };
    current.onmessageerror = () => current.onerror?.(new ErrorEvent("error"));
  };
  port.onmessage = (message: MessageEvent<ApiRequest>) => {
    const data = message.data;
    if (!data || !Number.isSafeInteger(data.id) || data.id < 1) return;
    if (data.type !== "generate") return;
    activeId = data.id;
    // Only transfer a bounded tile buffer; full validation remains in the worker.
    const colors = data.request?.colors;
    const transfer = colors instanceof Uint8Array && colors.buffer instanceof ArrayBuffer && colors.byteLength === 16384
      ? [colors.buffer] : [];
    try {
      if (!worker) startWorker();
      worker!.postMessage(data, transfer);
    } catch { failWorker(); }
  };
  window.addEventListener("pagehide", () => { worker?.terminate(); port.close(); }, { once: true });
  try { startWorker(); }
  catch { failWorker(); }
});
