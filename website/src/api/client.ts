/**
 * Hosted entry point. No generator, UI or catalog imports in this client.
 *
 * Public API:
 * - GenerateTileRequest
 * - GenerateTileResult
 * - GenerationOptions
 * - GeneratorConnection
 * - connect()
 */
import { API_CONNECT, API_PROTOCOL_VERSION, type ApiRequest, type ApiResponse } from "./protocol";
import type { GenerateTileRequest, GenerateTileResult, GeneratorConnection } from "./contract";
export type { GenerateTileRequest, GenerateTileResult, GenerationOptions, GeneratorConnection } from "./contract";

function failure(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function connect(): Promise<GeneratorConnection> {
  const bridge = new URL("api/bridge.html", new URL(/* @vite-ignore */ ".", import.meta.url));
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.title = "PNG-to-NBT generator";
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.src = bridge.href;
  const { port1: port, port2 } = new MessageChannel();
  let disposed = false;
  let nextId = 0;
  const pending = new Map<number, { request: GenerateTileRequest; resolve: (result: GenerateTileResult) => void; reject: (error: unknown) => void }>();
  const sendNext = () => {
    for (const [id, job] of pending) {
      try {
        port.postMessage({ type: "generate", id, request: job.request } satisfies ApiRequest, [job.request.colors.buffer]);
        return;
      } catch (error) {
        pending.delete(id);
        job.reject(error);
      }
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const job of pending.values()) job.reject(failure("DISPOSED", "Generator connection disposed"));
    pending.clear();
    port.close();
    port2.close();
    iframe.remove();
  };
  try {
    const ready = await new Promise<Extract<ApiResponse, { type: "ready" }>>((resolve, reject) => {
      const timer = setTimeout(() => finish(failure("CONNECTION_TIMEOUT", "Could not connect to PNG-to-NBT")), 30_000);
      const finish = (error: unknown) => { clearTimeout(timer); reject(error); };
      port.onmessageerror = () => finish(failure("PROTOCOL_ERROR", "Could not read generator response"));
      port.onmessage = (event: MessageEvent<ApiResponse>) => {
        if (event.data.type === "error") { finish(failure(event.data.code, event.data.message)); return; }
        if (event.data.type !== "ready") return;
        if (event.data.protocolVersion !== API_PROTOCOL_VERSION) { finish(failure("PROTOCOL_MISMATCH", "Generator interface version mismatch")); return; }
        clearTimeout(timer);
        resolve(event.data);
      };
      iframe.onload = () => {
        iframe.onload = null;
        iframe.contentWindow!.postMessage({ type: API_CONNECT, protocolVersion: API_PROTOCOL_VERSION }, bridge.origin, [port2]);
      };
      iframe.onerror = () => finish(failure("CONNECTION_FAILED", "Could not load generator bridge"));
      document.documentElement.append(iframe);
    });
    port.onmessageerror = () => dispose();
    port.onmessage = (event: MessageEvent<ApiResponse>) => {
      const response = event.data;
      if (response.type === "ready") return;
      const job = pending.get(response.id);
      if (!job) return;
      pending.delete(response.id);
      if (response.type === "error") job.reject(failure(response.code, response.message));
      else job.resolve(response.result);
      sendNext();
    };
    return {
      protocolVersion: ready.protocolVersion,
      engineRevision: ready.engineRevision,
      minecraftVersions: ready.minecraftVersions,
      async generateTile(request) {
        if (disposed) throw failure("DISPOSED", "Generator connection disposed");
        if (!(request?.colors instanceof Uint8Array) || request.colors.length !== 16384) {
          throw failure("INVALID_INPUT", "colors must be a 16384-byte Uint8Array");
        }
        // Snapshot queued inputs without retaining a subarray's potentially much larger buffer.
        const colors = new Uint8Array(request.colors);
        const snapshot = structuredClone({ ...request, colors }, { transfer: [colors.buffer] });
        const id = ++nextId;
        return new Promise<GenerateTileResult>((resolve, reject) => {
          pending.set(id, { request: snapshot, resolve, reject });
          if (pending.size === 1) sendNext();
        });
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
