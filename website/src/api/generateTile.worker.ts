/// <reference lib="WebWorker" />
/**
 * Public API:
 * - none
 *
 * Callers:
 * - src/api/bridge.ts
 */
import { MINECRAFT_VERSIONS } from "@/data/minecraftVersions";
import { generateTile } from "./generateTile";
import { API_PROTOCOL_VERSION, resultTransfers, type ApiRequest, type ApiResponse } from "./protocol";

function apiError(error: unknown, id: number): ApiResponse & { type: "error" } {
  return { type: "error", id,
    code: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "GENERATION_FAILED",
    message: error instanceof Error ? error.message : "Generation failed" };
}

self.postMessage({ type: "ready", protocolVersion: API_PROTOCOL_VERSION,
  engineRevision: import.meta.env.GENERATOR_REVISION ?? "development",
  minecraftVersions: Object.keys(MINECRAFT_VERSIONS) } satisfies ApiResponse);

self.onmessage = async (event: MessageEvent<ApiRequest>) => {
  if (event.data.type !== "generate") return;
  const { id, request } = event.data;
  try {
    const response: ApiResponse = { type: "result", id, result: await generateTile(request) };
    self.postMessage(response, resultTransfers(response));
  } catch (error) {
    self.postMessage(apiError(error, id));
  }
};
