/**
 * Public hosted API contract. Kept standalone for distribution as api.d.ts.
 *
 * Public API:
 * - GenerationMode
 * - GenerationOptions
 * - GenerateTileRequest
 * - GenerationWarning
 * - GenerateTileResult
 * - GeneratorConnection
 * - connect()
 *
 * Callers:
 * - src/api/client.ts
 * - src/api/generateTile.ts
 * - src/api/protocol.ts
 */
export type GenerationMode =
  | "flat" | "incline_up" | "incline_down"
  | "staircase_northline" | "staircase_southline" | "staircase_classic"
  | "staircase_valley" | "staircase_group" | "staircase_party"
  | "suppress_step_pairs" | "suppress_step_checker"
  | "suppress_2layer" | "suppress_2layer_late_fillers" | "suppress_2layer_late_pairs";

export interface GenerationOptions {
  /** Defaults to flat. Non-flat tiles require an explicit compatible mode; colors are never converted. */
  mode?: GenerationMode;
  /** A supported version key, not a range or arbitrary snapshot identifier. */
  minecraftVersion?: string;
  direction?: "east_to_west" | "west_to_east" | "north_to_south" | "south_to_north";
  centerOut?: boolean;
  /** Volatile: CrubTech options follow the current platform and may change or lose support when it is revised. */
  crubTech?: boolean;
  support?: "none" | "all" | "steps" | "fragile" | "water";
  supportBlock?: string;
  autoPickSupports?: boolean;
  /** Transparent growth cover; empty or air omits it. */
  growthCoverBlock?: string;
  shadeBlock?: string;
  /** Volatile; see crubTech. */
  crubTechBreakableBlock?: string;
  /** Volatile; see crubTech. */
  crubTechPushableBlock?: string;
  lateFillerBlock?: string;
  dominantVoidBlock?: string;
  recessiveVoidBlock?: string;
  layerGap?: number;
  latePairsGap?: number;
  belowPlatformWater?: boolean;
  /** Surface drops in dark, flat, light order. */
  waterDrops?: readonly [number, number, number];
  buildAtWorldMinY?: boolean;
  assumeSupportFloor?: boolean;
  reuseBlocks?: boolean;
  keepExtras?: boolean;
  maxBlockLift?: number;
  jumpableTops?: boolean;
  skipEmptySteps?: boolean;
  minStepOffset?: number;
  uniformStepSpacing?: boolean;
  markLoadSpots?: boolean;
  loadSpotBlock?: "jigsaw" | "barrier";
  paletteSeed?: boolean;
  /** Minimize Party's feasible color-height range; supports and covers may extend it. */
  partyMinHeight?: boolean;
  collapsePaletteStates?: boolean;
  forceXZ128?: boolean;
  forceZ129?: boolean;
  /** Volatile; see crubTech. */
  layerSplit?: boolean;
  /** Additional X-axis slope, for non-suppression modes only; run is 1-127. */
  westEastSlope?: { run: number; rise: number };
}

export interface GenerateTileRequest {
  /** Minecraft map bytes (base color * 4 + shade), indexed by z * 128 + x. */
  colors: Uint8Array;
  /** Explicit selections for every used nontransparent color. Catalog states are preserved. */
  blocks: Record<number, string>;
  options?: GenerationOptions;
}

export interface GenerationWarning {
  /** Stable identifier, listed in the documentation. The message wording may change. */
  code: string;
  message: string;
}

export interface GenerateTileResult {
  files: { name: string; data: Uint8Array }[];
  warnings: GenerationWarning[];
  effectiveOptions: Required<Omit<GenerationOptions, "westEastSlope">> & Pick<GenerationOptions, "westEastSlope">;
}

export interface GeneratorConnection {
  readonly protocolVersion: number;
  readonly engineRevision: string;
  readonly minecraftVersions: readonly string[];
  /** Calls are queued in order. Inputs are snapshotted; caller arrays are not transferred. */
  generateTile(request: GenerateTileRequest): Promise<GenerateTileResult>;
  /** Stop active work, reject queued requests and release the connection. */
  dispose(): void;
}

/** Connect once and reuse; all generation remains local to the browser. */
export declare function connect(): Promise<GeneratorConnection>;
