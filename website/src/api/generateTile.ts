/**
 * Validated, headless single-tile generation. No UI, storage, decoding or network access.
 *
 * Public API:
 * - generateTile()
 *
 * Callers:
 * - src/api/generateTile.worker.ts
 */
import * as defaults from "@/data/defaultSettings";
import { BASE_COLORS, WATER_BASE_INDEX } from "@/data/mapColors";
import { MINECRAFT_VERSIONS, type MinecraftVersion } from "@/data/minecraftVersions";
import { enCatalog } from "@/data/i18n/en";
import { Shade, type ColorGrid, type ShadedColorRef } from "@/types/color";
import { BuildMode, SuppressStepDirection, FillerRole } from "@/types/conversion";
import { SupportMode } from "@/types/ui";
import type { GenerateTileRequest, GenerateTileResult, GenerationOptions } from "./contract";
import {
  buildModeSupportsCenterOut, buildModeUsesLayerGap, buildModeUsesPaletteSeed, buildModeUsesWorldMinYGeometry,
  isCrubTechBuildMode, isStaircaseBuildMode, isSuppressBuildMode, isSuppressStepsBuildMode, shouldIncludeTransparentBlocks,
} from "@/utils/conversion";
import { MAP_SIZE } from "@/utils/color";
import { normalizeBlockId, resolveExportBlockName, stripDefaultBlockNamespace } from "@/lib/blockId";
import {
  canUseSuppressDirection, computeColorGridStats, deriveImageStats, getBelowPlatformWaterBlockedDirections,
  requiresTwoLayerLateShading, summarizeVoidShadows, FlatModeBehavior,
} from "@/lib/colorGridAnalysis";
import {
  createFillerAssignments, isCrubTechBreakableValid,
  isCrubTechPushableValid, isFillerDisabled, isShadeFillerDisabled, isWaterSideSupportFillerValid,
  getSupportModeFillerRoles,
} from "@/lib/fillerRules";
import {
  CRUBTECH_WATER_DROPS,
  getBuildAtWorldMinYEligibleForBuildMode,
  getUsedWaterShades,
  normalizeUsedWaterDrops,
  resolveTileWaterSetting,
  getPaletteSeedOffset,
  getTwoLayerSpacing,
  shouldAssumeSupportFloor,
} from "@/lib/generationPolicy";
import { getMinecraftCatalog, getVersionedBlockName, isBlockAvailable } from "@/lib/minecraftVersion";
import { countUnsupportedLifts, getGroundedStepColors, getMixedStepSettings } from "@/lib/mixedStepHeights";
import { getEnvironmentalSettings, isGrowthCoverEnabled, isGrowthCoverValid } from "@/lib/environmentalSupport";
import { getPlacementWarnings } from "@/lib/placementWarnings";
import { convertToCrubTechLayerSplitNbtEntries, convertToNbtEntries } from "@/lib/nbtExport";
import { analyzeBaseGeometry, analyzeFinalGeometry } from "@/lib/tileGeometry";

type EffectiveOptions = GenerateTileResult["effectiveOptions"];
const DEFAULT_OPTIONS: EffectiveOptions = {
  mode: BuildMode.Flat,
  minecraftVersion: defaults.DEFAULT_MINECRAFT_VERSION,
  direction: defaults.DEFAULT_SUPPRESS_STEP_DIRECTION,
  centerOut: defaults.DEFAULT_SUPPRESS_CENTER_OUT,
  crubTech: defaults.DEFAULT_CRUBTECH,
  support: defaults.DEFAULT_SUPPORT_MODE,
  supportBlock: defaults.DEFAULT_SUPPORT_FILLER_BLOCK,
  autoPickSupports: false,
  growthCoverBlock: defaults.DEFAULT_GROWTH_COVER_BLOCK,
  shadeBlock: defaults.DEFAULT_SHADE_FILLER_BLOCK,
  crubTechBreakableBlock: defaults.DEFAULT_CRUBTECH_SHADE_BREAKABLE_FILLER_BLOCK,
  crubTechPushableBlock: defaults.DEFAULT_CRUBTECH_SHADE_PUSHABLE_FILLER_BLOCK,
  lateFillerBlock: defaults.DEFAULT_SUPPRESS_2LAYER_LATE_FILLER_BLOCK,
  dominantVoidBlock: defaults.DEFAULT_DOMINATE_VOID_SHADE_FILLER_BLOCK,
  recessiveVoidBlock: defaults.DEFAULT_RECESSIVE_VOID_SHADE_FILLER_BLOCK,
  layerGap: defaults.DEFAULT_LAYER_GAP,
  latePairsGap: defaults.DEFAULT_SUPPRESS_2LAYER_LATE_PAIRS_GAP,
  belowPlatformWater: defaults.DEFAULT_BELOW_PLATFORM_WATER,
  waterDrops: [defaults.DEFAULT_DARK_WATER_DROP, defaults.DEFAULT_FLAT_WATER_DROP, defaults.DEFAULT_LIGHT_WATER_DROP],
  buildAtWorldMinY: defaults.DEFAULT_BUILD_AT_WORLD_MIN_Y,
  assumeSupportFloor: defaults.DEFAULT_APPLY_SUPPORT_FLOOR_YS,
  reuseBlocks: defaults.DEFAULT_MIX_STEPS,
  keepExtras: defaults.DEFAULT_KEEP_SUPPRESS_EXTRAS,
  maxBlockLift: defaults.MAX_STEP_COLOR_BLOCK_LIFT,
  jumpableTops: defaults.MIXED_STEP_REACHABLE_TOP,
  skipEmptySteps: defaults.DEFAULT_SKIP_EMPTY_SUPPRESS_STEPS,
  minStepOffset: defaults.DEFAULT_MIN_SUPPRESS_STEP_OFFSET,
  uniformStepSpacing: defaults.DEFAULT_UNIFORM_SUPPRESS_STEP_SPACING,
  markLoadSpots: defaults.DEFAULT_MARK_SUPPRESS_LOAD_SPOTS_IN_SCHEMATIC,
  loadSpotBlock: defaults.DEFAULT_SUPPRESS_LOAD_SPOT_MARKER_BLOCK,
  paletteSeed: defaults.DEFAULT_PALETTE_SEED,
  partyMinHeight: defaults.DEFAULT_PARTY_MIN_HEIGHT,
  collapsePaletteStates: defaults.DEFAULT_COLLAPSE_DUPLICATE_NBT_PALETTE_STATES,
  forceXZ128: defaults.DEFAULT_FORCE_XZ128,
  forceZ129: defaults.DEFAULT_FORCE_Z129,
  layerSplit: false,
};

function requireInput(condition: unknown, message: string): asserts condition {
  if (!condition) throw Object.assign(new Error(message), { code: "INVALID_INPUT" });
}

function record(value: unknown, name: string): asserts value is Record<string, unknown> {
  requireInput(value !== null && typeof value === "object"
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null), `${name} must be a plain object`);
}

function integer(value: unknown, min: number, max: number, name: string): void {
  requireInput(typeof value === "number" && Number.isInteger(value) && value >= min && value <= max,
    `${name} must be an integer from ${min} to ${max}`);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
  requireInput(values.includes(value as T), `Unsupported ${name}`);
  return value as T;
}

function blockEntry(value: unknown, name: string): asserts value is string {
  requireInput(typeof value === "string" && value.length <= 512
    && /^(?:minecraft:)?[a-z0-9_]+(?:\[[a-z0-9_]+=[a-z0-9_-]+(?:,[a-z0-9_]+=[a-z0-9_-]+)*\])?$/.test(value),
  `${name} must be a vanilla block ID with optional state properties`);
  const keys = [...value.matchAll(/([a-z0-9_]+)=/g)].map(match => match[1]);
  requireInput(new Set(keys).size === keys.length, `${name} has duplicate state properties`);
}

function resolveOptions(raw: GenerationOptions = {}) {
  record(raw, "options");
  for (const [key, value] of Object.entries(raw)) {
    requireInput(Object.hasOwn(DEFAULT_OPTIONS, key) || key === "westEastSlope", `Unknown option: ${key}`);
    if (value === undefined) continue;
    const baseline = DEFAULT_OPTIONS[key as keyof EffectiveOptions];
    if (typeof baseline === "boolean" || typeof baseline === "string") {
      requireInput(typeof value === typeof baseline, `Invalid type for ${key}`);
    }
  }
  const options = { ...DEFAULT_OPTIONS, ...Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)) };
  const mode = enumValue(options.mode, Object.values(BuildMode).filter(value =>
    value !== BuildMode.SuppressSplitRow && value !== BuildMode.SuppressSplitChecker), "mode");
  const minecraftVersion = enumValue(options.minecraftVersion, Object.keys(MINECRAFT_VERSIONS) as MinecraftVersion[], "Minecraft version");
  const direction = enumValue(options.direction, Object.values(SuppressStepDirection), "direction");
  const support = enumValue(options.support, Object.values(SupportMode), "support mode");
  enumValue(options.loadSpotBlock, defaults.SUPPRESS_LOAD_SPOT_MARKER_BLOCK_OPTIONS, "load-spot block");
  integer(options.layerGap, 2, 63, "layerGap");
  integer(options.latePairsGap, 1, 63, "latePairsGap");
  integer(options.maxBlockLift, 0, defaults.SUPPRESS_STEP_LIMITS.maxLift, "maxBlockLift");
  integer(options.minStepOffset, defaults.SUPPRESS_STEP_LIMITS.minOffset, defaults.SUPPRESS_STEP_LIMITS.maxOffset, "minStepOffset");
  requireInput(Array.isArray(options.waterDrops) && options.waterDrops.length === 3, "waterDrops must contain dark, flat and light drops");
  for (const drop of options.waterDrops) integer(drop, 0, 64, "waterDrops");
  if (options.westEastSlope !== undefined) {
    record(options.westEastSlope, "westEastSlope");
    requireInput(Object.keys(options.westEastSlope).every(key => key === "run" || key === "rise"), "Unknown westEastSlope option");
    integer(options.westEastSlope.run, 1, MAP_SIZE - 1, "westEastSlope.run");
    integer(options.westEastSlope.rise, -128, 128, "westEastSlope.rise");
    requireInput(!isSuppressBuildMode(mode), "westEastSlope requires a non-suppression mode");
  }
  for (const key of ["supportBlock", "growthCoverBlock", "shadeBlock", "crubTechBreakableBlock", "crubTechPushableBlock", "lateFillerBlock", "dominantVoidBlock", "recessiveVoidBlock"] as const) {
    if (key === "growthCoverBlock" && typeof options[key] === "string" && !options[key].trim()) continue;
    blockEntry(options[key], key);
  }
  return { ...options, mode, minecraftVersion, direction, support };
}

function plural(forms: string | { one?: string; other: string }, count: number): string {
  return typeof forms === "string" ? forms : count === 1 ? forms.one ?? forms.other : forms.other;
}

// Published codes, kept apart from the internal kind names so that those can be renamed.
const PLACEMENT_CODES: Record<ReturnType<typeof getPlacementWarnings>[number]["kind"], string> = {
  missingSupport: "PLACEMENT_MISSING_SUPPORT", shelfSupport: "PLACEMENT_SHELF_SUPPORT", falling: "PLACEMENT_FALLING",
  attachmentSupport: "PLACEMENT_ATTACHMENT_SUPPORT", scaffoldSupportFiller: "PLACEMENT_SCAFFOLD_SUPPORT_FILLER",
  scaffoldConnection: "PLACEMENT_SCAFFOLD_CONNECTION", supportMode: "PLACEMENT_SUPPORT_MODE", supportBlock: "PLACEMENT_SUPPORT_BLOCK",
  autoSupport: "PLACEMENT_AUTO_SUPPORT", transparentSupport: "PLACEMENT_TRANSPARENT_SUPPORT", invalidSupport: "PLACEMENT_INVALID_SUPPORT",
  cropLight: "PLACEMENT_CROP_LIGHT", mushroomLight: "PLACEMENT_MUSHROOM_LIGHT", mushroomSpread: "PLACEMENT_MUSHROOM_SPREAD",
  missingCover: "PLACEMENT_MISSING_COVER", growthCover: "PLACEMENT_GROWTH_COVER", coralSupport: "PLACEMENT_CORAL_SUPPORT",
  tntIgnition: "PLACEMENT_TNT_IGNITION", tnt: "PLACEMENT_TNT", fireSpread: "PLACEMENT_FIRE_SPREAD", grassSpread: "PLACEMENT_GRASS_SPREAD",
  iceMelt: "PLACEMENT_ICE_MELT", snowMelt: "PLACEMENT_SNOW_MELT", iceSnowMelt: "PLACEMENT_ICE_SNOW_MELT", meltRisk: "PLACEMENT_MELT_RISK",
  snowRisk: "PLACEMENT_SNOW_RISK", iceSnowRisk: "PLACEMENT_ICE_SNOW_RISK", frostedIce: "PLACEMENT_FROSTED_ICE",
};

function canonicalBlock(block: string): string {
  const resolved = resolveExportBlockName(block);
  const bracket = resolved.indexOf("[");
  return bracket < 0 ? resolved : `${resolved.slice(0, bracket)}[${resolved.slice(bracket + 1, -1).split(",").sort().join(",")}]`;
}

function readTile(request: GenerateTileRequest, version: MinecraftVersion) {
  requireInput(request.colors instanceof Uint8Array && request.colors.length === MAP_SIZE * MAP_SIZE, "colors must be a 16384-byte Uint8Array");
  record(request.blocks, "blocks");
  requireInput(Object.keys(request.blocks).length <= BASE_COLORS.length, "Too many block selections");
  const dataVersion = MINECRAFT_VERSIONS[version].dataVersion;
  const catalog = getMinecraftCatalog(dataVersion);
  const selectedBlocks: Record<number, string> = Object.fromEntries(BASE_COLORS.map((_, id) => [id, ""]));
  for (const [key, block] of Object.entries(request.blocks)) {
    const id = Number(key);
    integer(id, 0, BASE_COLORS.length - 1, "Block color ID");
    requireInput(String(id) === key, "Block color IDs must be decimal integers");
    if (block === "") continue;
    blockEntry(block, `blocks[${id}]`);
    const versioned = getVersionedBlockName(block, dataVersion);
    const canonical = canonicalBlock(versioned);
    requireInput([...catalog.blocks[id], ...catalog.excluded[id]].some(candidate => canonicalBlock(candidate) === canonical),
      `blocks[${id}] is not a catalog state for that color in Minecraft ${version}`);
    selectedBlocks[id] = stripDefaultBlockNamespace(versioned);
  }
  const states: ShadedColorRef[] = Array.from({ length: BASE_COLORS.length * 4 }, (_, byte) => ({
    id: byte >> 2, shade: (byte & 3) as Shade, isCustom: false,
  }));
  // Check each distinct byte once; the first bad byte is also the first bad pixel.
  for (const byte of new Set(request.colors)) {
    const id = byte >> 2;
    if (id >= BASE_COLORS.length || id !== 0 && (byte & 3) === Shade.Darkest) {
      const at = request.colors.indexOf(byte);
      requireInput(false, `Unsupported map-color byte ${byte} at ${at % MAP_SIZE},${Math.floor(at / MAP_SIZE)}`);
    }
    requireInput(id === 0 || !!selectedBlocks[id], `Missing block selection for color ${id}`);
  }
  const colorGrid: ColorGrid = Array.from({ length: MAP_SIZE }, (_, x) => Array.from({ length: MAP_SIZE }, (_, z) => {
    const byte = request.colors[z * MAP_SIZE + x];
    return states[byte >> 2 === 0 ? 0 : byte];
  }));
  return { colorGrid, selectedBlocks };
}

export async function generateTile(request: GenerateTileRequest): Promise<GenerateTileResult> {
  record(request, "request");
  requireInput(Object.keys(request).every(key => ["colors", "blocks", "options"].includes(key)), "Unknown request field");
  const options = resolveOptions(request.options);
  const mode = options.mode;
  const version = options.minecraftVersion;
  const dataVersion = MINECRAFT_VERSIONS[version].dataVersion;
  const { colorGrid, selectedBlocks } = readTile(request, version);
  const stats = computeColorGridStats(colorGrid);
  const derived = deriveImageStats(stats);
  const shades = getUsedWaterShades(derived.usedShadesByColorKey);
  const hasWater = shades.size > 0;
  const steps = isSuppressStepsBuildMode(mode);
  const warnings: GenerateTileResult["warnings"] = [];
  const warn = (code: string, message: string) => warnings.push({ code, message });
  requireInput(!options.crubTech || isCrubTechBuildMode(mode), "CrubTech requires suppress_2layer or suppress_2layer_late_pairs");
  if (options.crubTech) {
    options.direction = SuppressStepDirection.EastToWest;
    options.centerOut = false;
    options.waterDrops = CRUBTECH_WATER_DROPS;
    options.belowPlatformWater = options.assumeSupportFloor = options.forceXZ128 = options.forceZ129 = true;
    options.support = options.support === SupportMode.None ? SupportMode.None : SupportMode.All;
    selectedBlocks[0] = "";
    warn("CRUBTECH_CONSTRAINTS", "CrubTech fixes direction, platform spacing, water drops, support policy and export bounds.");
  }
  requireInput(!options.layerSplit || options.crubTech, "layerSplit requires CrubTech");
  requireInput(!options.centerOut || buildModeSupportsCenterOut(mode), "centerOut requires a steps or 2-layer mode");
  requireInput(!options.keepExtras || steps, "keepExtras requires a suppression-steps mode");
  options.reuseBlocks &&= steps;
  options.skipEmptySteps &&= !options.keepExtras;
  options.assumeSupportFloor = shouldAssumeSupportFloor(options.assumeSupportFloor, mode, options.support, options.supportBlock);
  options.waterDrops = normalizeUsedWaterDrops(options.waterDrops, shades);
  requireInput(options.waterDrops.every(drop => drop <= 64), "Used water shades need distinct drops within 0-64");
  const waterBlock = normalizeBlockId(selectedBlocks[WATER_BASE_INDEX]);
  const directWater = waterBlock === "water", iceWater = waterBlock === "ice";
  const waterSetting = resolveTileWaterSetting(derived, mode, options.belowPlatformWater, options.crubTech, directWater, options.waterDrops);
  const drops = waterSetting?.kind === "below-platform" ? waterSetting.drops : undefined;
  requireInput(canUseSuppressDirection(mode, options.direction, summarizeVoidShadows([stats]), hasWater, options.centerOut)
    && (!steps || !getBelowPlatformWaterBlockedDirections([{ colorGrid }], drops).has(options.direction)),
  "This direction/center-out combination cannot preserve the tile's water or void shading");
  const needsLateShading = requiresTwoLayerLateShading(colorGrid, drops);
  requireInput(!buildModeUsesLayerGap(mode) || (mode === BuildMode.Suppress2Layer ? !needsLateShading : needsLateShading),
    needsLateShading ? "This tile requires a 2-layer late-fillers or late-pairs mode" : "This tile uses ordinary suppress_2layer; no late shading is needed");
  const selections = { selectedBlocks, selectedBlocksCustom: {}, customColors: [], minecraftVersion: version, autoPickSupports: options.autoPickSupports };
  const environmentalPalette = getEnvironmentalSettings(derived.usedShadesByColorKey.keys(), selections, isGrowthCoverEnabled(options.growthCoverBlock)).palette;
  const spacing = getTwoLayerSpacing(options.support, options.layerGap, options.latePairsGap, options.crubTech,
    environmentalPalette?.minimumLayerGap);
  options.layerGap = spacing.layerGap;
  options.latePairsGap = spacing.latePairsGap;
  const eastWest = options.direction === SuppressStepDirection.EastToWest || options.direction === SuppressStepDirection.WestToEast;
  const canLift = options.reuseBlocks && eastWest;
  const mixed = canLift ? getMixedStepSettings(derived.usedShadesByColorKey.keys(), selections, options.support,
    options.shadeBlock, options.supportBlock, options.assumeSupportFloor, options.maxBlockLift, options.jumpableTops, options.growthCoverBlock) : { maxHeight: 0 };
  if (options.maxBlockLift > 0 && mixed.maxHeight === 0) warn("LIFT_INACTIVE", "Raised reuse is inactive for these generation/support/block settings.");
  const blockedLifts = mixed.unsupported ? countUnsupportedLifts(colorGrid, mixed.palette, mixed.unsupported) : 0;
  if (blockedLifts) {
    warn("LIFT_UNSUPPORTED", plural(enCatalog.preview.liftSupport, blockedLifts)
      .replace("{support}", options.supportBlock).replace("{count}", String(blockedLifts))
      + `\n${enCatalog.preview.liftSupportDetail.replace("{blocks}", mixed.unsupported!.blocks.join(", "))}`);
  }
  options.maxBlockLift = mixed.maxHeight;
  options.jumpableTops &&= options.maxBlockLift === 1;
  options.paletteSeed &&= buildModeUsesPaletteSeed(mode);
  options.partyMinHeight &&= mode === BuildMode.StaircaseParty;
  const paletteSeed = options.paletteSeed ? getPaletteSeedOffset(selectedBlocks) : 0;
  // The mode is explicit, so skip the UI's staircase discovery. Build only the base shapes its checks read:
  // the northline for flat, an incline tile's incline, or the mode's own shape for world-minimum-Y eligibility.
  const incline = mode === BuildMode.InclineUp || mode === BuildMode.InclineDown;
  options.buildAtWorldMinY &&= waterSetting?.kind !== "below-platform" && buildModeUsesWorldMinYGeometry(mode);
  const base = mode === BuildMode.Flat || incline || options.buildAtWorldMinY ? analyzeBaseGeometry({ colorGrid,
    allSameShade: derived.allSameShade, hasWater, hasTransparency: derived.hasTransparency, northlineOnly: true,
    selectedStaircase: incline ? undefined : mode, includeTransparentBlocks: !!selectedBlocks[0], waterSetting,
    flatModeBehavior: derived.flatModeBehavior, layerGap: options.layerGap, paletteSeed, partyMinHeight: options.partyMinHeight,
    enableWaterConvenience: options.support !== SupportMode.None }) : null;
  options.buildAtWorldMinY &&= getBuildAtWorldMinYEligibleForBuildMode(
    [{ ...base!, tile: { colorGrid }, flatModeBehavior: derived.flatModeBehavior }], mode, options.assumeSupportFloor);
  requireInput(mode !== BuildMode.Flat || base?.isFlatShape, "This tile cannot use flat mode; specify a compatible generation mode");
  requireInput(mode !== BuildMode.Flat || derived.flatModeBehavior !== FlatModeBehavior.ToggleableBuildAtWorldMinY
    || options.buildAtWorldMinY, "Flat mode requires buildAtWorldMinY for this tile");
  requireInput(!incline || !!base!.baseShapeMap[mode], "This tile cannot use the requested incline mode");
  const geometry = analyzeFinalGeometry({ colorGrid, allSameShade: derived.allSameShade, hasWater,
    environmentalPalette,
    hasTransparency: derived.hasTransparency, requiresTwoLayerLateShading: needsLateShading,
    includeTransparentBlocks: shouldIncludeTransparentBlocks(selectedBlocks, derived.hasTransparency, mode), waterSetting,
    buildAtWorldMinY: options.buildAtWorldMinY, buildMode: mode, isFlatShape: base?.isFlatShape ?? false,
    layerGap: options.layerGap, suppress2LayerLatePairY: options.layerGap + options.latePairsGap,
    useCrubTech: options.crubTech, mixSteps: options.reuseBlocks, mixedStepMaxHeight: options.maxBlockLift,
    mixedStepPalette: mixed.palette,
    groundedStepColors: getGroundedStepColors(derived.usedShadesByColorKey.keys(), selections, options.support, options.supportBlock),
    paletteSeed, partyMinHeight: options.partyMinHeight, enableWaterConvenience: options.support !== SupportMode.None,
    skipEmptySuppressSteps: options.skipEmptySteps, minSuppressStepOffset: options.minStepOffset,
    uniformSuppressStepSpacing: options.uniformStepSpacing, keepSuppressExtras: options.keepExtras,
    collapseStaircaseModes: false, includeFlatNorthline: false,
    selectedStepDirection: options.direction, suppressCenterOut: steps && options.centerOut });
  requireInput(geometry.supportShape, "The requested mode cannot generate this tile");
  const fillerAssignments = createFillerAssignments(options.supportBlock, options.shadeBlock, options.crubTechBreakableBlock,
    options.crubTechPushableBlock, options.lateFillerBlock, options.dominantVoidBlock, options.recessiveVoidBlock,
    options.support, options.crubTech, directWater, iceWater, options.growthCoverBlock);
  const neededRoles = geometry.fillerNeedStats?.roleCounts;
  const supportRoles = getSupportModeFillerRoles(options.support, directWater, iceWater, options.crubTech);
  let knownBlocks: Set<string> | undefined;
  for (const { role, block } of fillerAssignments) {
    if (!neededRoles?.get(role)) continue;
    const support = supportRoles.includes(role);
    // Disabled supports are a placement warning, just like selecting Support=None.
    if (support && isFillerDisabled(block)) continue;
    requireInput(isBlockAvailable(block, dataVersion), `${block} is unavailable in Minecraft ${version}`);
    if (!knownBlocks) {
      const catalog = getMinecraftCatalog(dataVersion);
      knownBlocks = new Set([...catalog.blocks, ...catalog.excluded].flat().map(normalizeBlockId));
    }
    requireInput(knownBlocks.has(normalizeBlockId(block)), `Unknown filler block: ${block}`);
    requireInput(role === FillerRole.GrowthCover ? isGrowthCoverValid(block)
      : support || !isShadeFillerDisabled(block), `Invalid ${role} block: ${block}`);
    requireInput(!isFillerDisabled(block), `Required filler cannot be disabled: ${role}`);
  }
  if (options.crubTech) {
    requireInput(isCrubTechBreakableValid(options.crubTechBreakableBlock) && isCrubTechPushableValid(options.crubTechPushableBlock), "Invalid CrubTech breakable/pushable fillers");
  }
  for (const { kind, blocks, support, spreadable } of getPlacementWarnings([geometry.supportShape], selections, fillerAssignments,
    options.assumeSupportFloor, mode, options.crubTech)) {
    warn(PLACEMENT_CODES[kind], plural(enCatalog.preview.placementWarnings[kind], blocks.length).replace("{blocks}", blocks.join(", "))
      + (support ? `\n${enCatalog.preview.invalidSupportDetail.replace("{support}", support)}` : "")
      + (spreadable ? `\n${plural(enCatalog.preview.mushroomSpreadCount, spreadable).replace("{count}", String(spreadable))}` : ""));
  }
  if (neededRoles?.get(FillerRole.SupportWaterSides) && options.support !== SupportMode.None && directWater && !isWaterSideSupportFillerValid(options.supportBlock)) {
    warn("WATER_SUPPORT", "Water-side supports should have transparent map color.");
  }
  if (steps && !eastWest) {
    warn("NORTH_SOUTH_STEPS", "North/south suppression can raise color blocks to preserve shading.");
  }
  if (buildModeUsesLayerGap(mode) && !eastWest) {
    warn("NORTH_SOUTH_TWO_LAYER", "Clear one row per step (per side for center-out), requiring twice as many steps.");
  }
  if (isStaircaseBuildMode(mode) && stats.voidShadowStats.dominant + stats.voidShadowStats.recessive > 0) {
    warn("VOID_FILLERS", "Temporary void-shading fillers may require selective map updates and removal.");
  }
  if (options.buildAtWorldMinY) warn("WORLD_MIN_Y", "This layout requires building at the dimension's minimum Y.");
  if (options.keepExtras) warn("KEEP_EXTRAS", "Barriers mark required air. Clear Wrong blocks, ignore Extras; clear taller leftovers separately.");
  const exportTile = options.layerSplit ? convertToCrubTechLayerSplitNbtEntries : convertToNbtEntries;
  const files = await exportTile(geometry.supportShape, { ...selections, fillerAssignments,
    applySupportFloorYs: options.assumeSupportFloor, collapseDuplicatePaletteStates: options.collapsePaletteStates,
    forceXZ128: options.forceXZ128, forceZ129: options.forceZ129, baseName: "tile", buildMode: mode,
    suppressStepDirection: options.direction, suppressCenterOut: options.centerOut,
    keepSuppressExtras: options.keepExtras, suppress2LayerLatePairY: options.layerGap + options.latePairsGap,
    crubTech: options.crubTech, markSuppressLoadSpotsInSchematic: options.markLoadSpots,
    suppressLoadSpotMarkerBlock: options.loadSpotBlock, westEastSlope: options.westEastSlope });
  return { files, warnings, effectiveOptions: options };
}
