/**
 * Public API:
 * - API_PROTOCOL_VERSION
 * - API_CONNECT
 * - ApiRequest
 * - ApiResponse
 * - resultTransfers()
 *
 * Callers:
 * - src/api/bridge.ts
 * - src/api/client.ts
 * - src/api/generateTile.worker.ts
 */
import type { GenerateTileRequest, GenerateTileResult } from "./contract";

export const API_PROTOCOL_VERSION = 1;
export const API_CONNECT = "png-to-nbt:connect";

export type ApiRequest = { type: "generate"; id: number; request: GenerateTileRequest };
export type ApiResponse =
  | { type: "ready"; protocolVersion: number; engineRevision: string; minecraftVersions: string[] }
  | { type: "result"; id: number; result: GenerateTileResult }
  | { type: "error"; id: number; code: string; message: string };

export function resultTransfers(message: ApiResponse): ArrayBuffer[] {
  return message.type === "result" ? message.result.files.map(file => file.data.buffer as ArrayBuffer) : [];
}
