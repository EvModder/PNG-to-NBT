/**
 * Public API:
 * - PanelColorBlockTable()
 *
 * Callers:
 * - src/Index.tsx
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Glasses, Minus, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { DEFAULT_COLOR_ROW_ORDER } from "@/data/colorSortOrder";
import { BASE_COLORS, Shade, TRANSPARENCY_BASE_INDEX, WATER_BASE_INDEX } from "@/data/mapColors";
import { EXCLUDED_BLOCKS } from "@/data/mapColorsExcluded";
import { getBlockIconAsset } from "@/lib/blockIconAtlas";
import { getColorRefCount, getColorRefKey, type ColorRefKey } from "@/lib/colorRefs";
import { normalizeBlockId } from "@/lib/blockId";
import { messages } from "@/lib/messages";
import type { SortDir, SortKey, BlockDisplayMode, ColumnId } from "@/types/ui";
import { getHue, getShadedRgb } from "@/utils/color";
import {
  SWATCH_TOOLTIP_OFFSET_PX,
  formatSwatchHex,
  getMultiShadeSwatchStyle,
  getOrderedSwatchShades,
  getShadeAtPointer,
  getSwatchRequiredAccentText,
} from "@/utils/colorSwatch";
import { formatStacks } from "@/utils/minecraft";
import {
  MUTED_INLINE_TOGGLE_CONTROL_CLASS,
  PANEL_TITLE_TEXT_CLASS,
} from "@/utils/uiTypography";
import {
  APPROX_TABLE_MONO_CHAR_WIDTH_PX,
  COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX,
  INITIAL_BLOCK_SELECT_HORIZONTAL_INSETS_PX,
  MIN_REQUIRED_COLUMN_WIDTH_PX,
  type ColorTableLayout,
} from "@/utils/colorTableLayout";
import { PackedBlockIcon } from "@/components/PackedBlockIcon";

const COLOR_TABLE_HEADER_GROUP_GAP_PX = 6;
const CUSTOM_OPTION_GROUP_CLASS =
  "shrink-0 inline-flex items-center gap-0.5 rounded bg-cyan-600/[0.08] ring-1 ring-cyan-700/55 dark:bg-cyan-300/[0.12] dark:ring-cyan-300/55";
// Initial collapsed-width estimate before the block-header toggle button is measured.
// This matches the current collapsed Block-header control closely enough to avoid a first-render
// width jump while still letting the real measurement take over immediately afterward.
const INITIAL_COLLAPSED_BLOCK_COLUMN_WIDTH_PX = 44;
// `gap-1` in the row grid.
const COLOR_TABLE_GRID_GAP_PX = 4;
// Horizontal `p-2` plus the 1px left/right border of the table container.
const COLOR_TABLE_SECTION_HORIZONTAL_INSETS_PX = 8 * 2 + 1 * 2;

type ColumnDropSide = "before" | "after";
type ColumnDragIndicator = { target: ColumnId; side: ColumnDropSide };
type SwatchTooltip = { text: string; accentText?: string; x: number; y: number };

const BELOW_PLATFORM_WATER_BLOCK_OPTIONS = [
  "glass_pane[east=true,north=true,south=true,west=true,waterlogged=true]",
  "iron_bars[east=true,north=true,south=true,west=true,waterlogged=true]",
] as const;

function getConditionalBaseBlocks(baseIndex: number, belowPlatformWater: boolean): readonly string[] {
  return baseIndex === WATER_BASE_INDEX && belowPlatformWater
    ? BELOW_PLATFORM_WATER_BLOCK_OPTIONS
    : [];
}

type PanelColorBlockTableProps = {
  isStackedLayout: boolean;
  imageValid: boolean;
  belowPlatformWater: boolean;
  hasRequiredCol: boolean;
  showUsageInfo: boolean;
  showIds: boolean;
  setShowIds: Dispatch<SetStateAction<boolean>>;
  showNames: boolean;
  setShowNames: Dispatch<SetStateAction<boolean>>;
  showOptions: boolean;
  setShowOptions: Dispatch<SetStateAction<boolean>>;
  showStacks: boolean;
  setShowStacks: Dispatch<SetStateAction<boolean>>;
  showMaxPerSplit: boolean;
  setShowMaxPerSplit: Dispatch<SetStateAction<boolean>>;
  showMaxPerSplitOption: boolean;
  blockDisplayMode: BlockDisplayMode;
  setBlockDisplayMode: Dispatch<SetStateAction<BlockDisplayMode>>;
  blockColExpanded: boolean;
  setBlockColExpanded: Dispatch<SetStateAction<boolean>>;
  sortKey: SortKey;
  setSortKey: Dispatch<SetStateAction<SortKey>>;
  sortDir: SortDir;
  setSortDir: Dispatch<SetStateAction<SortDir>>;
  showUnusedColors: boolean;
  setShowUnusedColors: Dispatch<SetStateAction<boolean>>;
  showTransparentRow: boolean;
  showExcludedBlocks: boolean;
  columnOrder: ColumnId[];
  setColumnOrder: Dispatch<SetStateAction<ColumnId[]>>;
  selectedBlocks: Record<number, string>;
  customBlocksByBase: Record<number, string[]>;
  usedShadesByColorKey: ReadonlyMap<ColorRefKey, ReadonlySet<Shade>>;
  shadeCountsByColorKey: ReadonlyMap<ColorRefKey, ReadonlyMap<Shade, number>>;
  sortColorCounts: Readonly<Record<string, number>>;
  displayColorCounts: Readonly<Record<string, number>>;
  formatRequiredCount: (count: number) => string | number;
  missingColorKeys: ReadonlySet<ColorRefKey>;
  onUpdateBlock: (baseIndex: number, block: string) => void;
  onCopyColorToClipboard: (r: number, g: number, b: number) => void;
  onLayoutChange: (layout: ColorTableLayout) => void;
  onMinWidthChange: (widthPx: number) => void;
};

function reorderColumnOrder(order: ColumnId[], from: ColumnId, target: ColumnId, side: ColumnDropSide): ColumnId[] {
  if (from === target) return order;
  const next = order.filter(col => col !== from);
  const targetIndex = next.indexOf(target);
  if (targetIndex === -1) return order;
  next.splice(targetIndex + (side === "after" ? 1 : 0), 0, from);
  return next;
}

function normalizeColumnDropTarget(
  order: ColumnId[],
  target: ColumnId,
  side: ColumnDropSide,
): ColumnDragIndicator | null {
  const index = order.indexOf(target);
  if (index === -1) return null;
  if (side === "after" && index < order.length - 1) {
    return { target: order[index + 1], side: "before" };
  }
  return { target, side };
}

function wouldReorderColumnOrder(order: ColumnId[], from: ColumnId, indicator: ColumnDragIndicator): boolean {
  const next = reorderColumnOrder(order, from, indicator.target, indicator.side);
  return next.length === order.length && next.some((col, index) => col !== order[index]);
}

function measureNoWrapSectionWidth(el: HTMLElement): number {
  const { width, minWidth, maxWidth, flexWrap } = el.style;
  el.style.width = "max-content";
  el.style.minWidth = "max-content";
  el.style.maxWidth = "none";
  el.style.flexWrap = "nowrap";
  const measured = Math.ceil(el.getBoundingClientRect().width);
  el.style.width = width;
  el.style.minWidth = minWidth;
  el.style.maxWidth = maxWidth;
  el.style.flexWrap = flexWrap;
  return measured;
}

// Callers:
// - src/Index.tsx
export function PanelColorBlockTable({
  isStackedLayout,
  imageValid,
  belowPlatformWater,
  hasRequiredCol,
  showUsageInfo,
  showIds,
  setShowIds,
  showNames,
  setShowNames,
  showOptions,
  setShowOptions,
  showStacks,
  setShowStacks,
  showMaxPerSplit,
  setShowMaxPerSplit,
  showMaxPerSplitOption,
  blockDisplayMode,
  setBlockDisplayMode,
  blockColExpanded,
  setBlockColExpanded,
  sortKey,
  setSortKey,
  sortDir,
  setSortDir,
  showUnusedColors,
  setShowUnusedColors,
  showTransparentRow,
  showExcludedBlocks,
  columnOrder,
  setColumnOrder,
  selectedBlocks,
  customBlocksByBase,
  usedShadesByColorKey,
  shadeCountsByColorKey,
  sortColorCounts,
  displayColorCounts,
  formatRequiredCount,
  missingColorKeys,
  onUpdateBlock,
  onCopyColorToClipboard,
  onLayoutChange,
  onMinWidthChange,
}: PanelColorBlockTableProps) {
  const getBaseColorKey = useCallback((idx: number) => getColorRefKey({ id: idx, isCustom: false }), []);
  const getBaseSortRequiredCount = useCallback(
    (idx: number) => getColorRefCount(sortColorCounts, { id: idx, isCustom: false }),
    [sortColorCounts],
  );
  const getBaseDisplayRequiredCount = useCallback(
    (idx: number) => getColorRefCount(displayColorCounts, { id: idx, isCustom: false }),
    [displayColorCounts],
  );
  const dragColRef = useRef<ColumnId | null>(null);
  const dragColumnIndicatorRef = useRef<ColumnDragIndicator | null>(null);
  const [dragColumnIndicator, setDragColumnIndicator] = useState<ColumnDragIndicator | null>(null);
  const [swatchTooltip, setSwatchTooltip] = useState<SwatchTooltip | null>(null);
  const swatchTooltipRafRef = useRef<number | null>(null);
  const swatchTooltipPendingRef = useRef<SwatchTooltip | null>(null);
  const blockMeasureSelectRef = useRef<HTMLSelectElement | null>(null);
  const blockHeaderCollapseBtnRef = useRef<HTMLButtonElement | null>(null);
  const colorTableHeaderRef = useRef<HTMLDivElement>(null);
  const [blockMeasureFont, setBlockMeasureFont] = useState("11px monospace");
  const [blockMeasureInsetsPx, setBlockMeasureInsetsPx] = useState(INITIAL_BLOCK_SELECT_HORIZONTAL_INSETS_PX);
  const [blockTextureCollapsedWidthPx, setBlockTextureCollapsedWidthPx] = useState(INITIAL_COLLAPSED_BLOCK_COLUMN_WIDTH_PX);
  const [colorTableHeaderMinWidthPx, setColorTableHeaderMinWidthPx] = useState(0);

  const requiredColWidth = useMemo(() => {
    if (!hasRequiredCol) return MIN_REQUIRED_COLUMN_WIDTH_PX;
    const maxLen = Math.max(
      0,
      ...BASE_COLORS.map((_, baseIndex) => getBaseSortRequiredCount(baseIndex))
        .filter(count => count > 0)
        .map(count => String(showStacks ? formatStacks(count) : count).length),
    );
    return Math.max(MIN_REQUIRED_COLUMN_WIDTH_PX, maxLen * 6 + 16);
  }, [getBaseSortRequiredCount, hasRequiredCol, showStacks]);

  const visibleColumns = useMemo(
    () =>
      columnOrder.filter(column => {
        if (column === "id" && !showIds) return false;
        if (column === "name" && !showNames) return false;
        if (column === "options" && !showOptions) return false;
        if (column === "required" && !hasRequiredCol) return false;
        return true;
      }),
    [columnOrder, showIds, showNames, showOptions, hasRequiredCol],
  );

  const longestBlockName = useMemo(() => {
    let longest: string = messages.common.none;
    for (let idx = 0; idx < BASE_COLORS.length; ++idx) {
      const excluded = showExcludedBlocks ? EXCLUDED_BLOCKS[idx] ?? [] : [];
      const extra = customBlocksByBase[idx] || [];
      for (const block of BASE_COLORS[idx].blocks) if (block.length > longest.length) longest = block;
      for (const block of getConditionalBaseBlocks(idx, belowPlatformWater)) if (block.length > longest.length) longest = block;
      for (const block of excluded) if (block.length > longest.length) longest = block;
      for (const block of extra) if (block.length > longest.length) longest = block;
      const selected = selectedBlocks[idx] || "";
      if (selected.length > longest.length) longest = selected;
    }
    return longest;
  }, [belowPlatformWater, customBlocksByBase, selectedBlocks, showExcludedBlocks]);

  const sortedIndices = useMemo(() => {
    const base = showTransparentRow ? [TRANSPARENCY_BASE_INDEX, ...DEFAULT_COLOR_ROW_ORDER] : [...DEFAULT_COLOR_ROW_ORDER];
    if (sortKey === "default") return base;
    const dir = sortDir === "asc" ? 1 : -1;
    const sorters: Record<string, (a: number, b: number) => number> = {
      name: (a, b) => dir * BASE_COLORS[a].name.localeCompare(BASE_COLORS[b].name),
      options: (a, b) => dir * (BASE_COLORS[a].blocks.length - BASE_COLORS[b].blocks.length),
      color: (a, b) =>
        dir *
        (getHue(BASE_COLORS[a].r, BASE_COLORS[a].g, BASE_COLORS[a].b) -
          getHue(BASE_COLORS[b].r, BASE_COLORS[b].g, BASE_COLORS[b].b)),
      id: (a, b) => dir * (a - b),
      required: (a, b) => dir * (getBaseSortRequiredCount(a) - getBaseSortRequiredCount(b)),
    };
    return sorters[sortKey] ? base.toSorted(sorters[sortKey]) : base;
  }, [sortKey, sortDir, getBaseSortRequiredCount, showTransparentRow]);

  const { usedIndices, unusedIndices } = useMemo(() => {
    if (!imageValid || usedShadesByColorKey.size === 0) return { usedIndices: sortedIndices, unusedIndices: [] as number[] };
    return {
      usedIndices: sortedIndices.filter(index => usedShadesByColorKey.has(getBaseColorKey(index))),
      unusedIndices: sortedIndices.filter(index => !usedShadesByColorKey.has(getBaseColorKey(index))),
    };
  }, [imageValid, sortedIndices, usedShadesByColorKey, getBaseColorKey]);

  useLayoutEffect(() => {
    const el = blockMeasureSelectRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    if (cs.font) setBlockMeasureFont(cs.font);
    const insets =
      parseFloat(cs.paddingLeft || "0") +
      parseFloat(cs.paddingRight || "0") +
      parseFloat(cs.borderLeftWidth || "0") +
      parseFloat(cs.borderRightWidth || "0");
    if (Number.isFinite(insets) && insets >= 0) setBlockMeasureInsetsPx(insets);
  }, [blockDisplayMode, showIds, showNames, showOptions, imageValid]);

  const blockColMinWidthPx = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.font = blockMeasureFont;
    const textWidth = ctx ? ctx.measureText(longestBlockName).width : longestBlockName.length * APPROX_TABLE_MONO_CHAR_WIDTH_PX;
    return Math.ceil(textWidth + Math.max(0, blockMeasureInsetsPx));
  }, [blockMeasureFont, blockMeasureInsetsPx, longestBlockName]);

  useLayoutEffect(() => {
    const button = blockHeaderCollapseBtnRef.current;
    if (!button) return;
    const measure = () => {
      const width = Math.ceil(button.getBoundingClientRect().width) + 2;
      if (Number.isFinite(width) && width > 0) {
        setBlockTextureCollapsedWidthPx(prev => (Math.abs(prev - width) > 1 ? width : prev));
      }
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(button);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [blockColExpanded, blockDisplayMode, columnOrder, showIds, showNames, showOptions]);

  useLayoutEffect(() => {
    const header = colorTableHeaderRef.current;
    if (!header) return;
    const measure = () => {
      const measured = measureNoWrapSectionWidth(header);
      setColorTableHeaderMinWidthPx(prev => (Math.abs(prev - measured) > 1 ? measured : prev));
    };
    measure();
    let rafId = 0;
    const schedule = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(header);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [
    blockColExpanded,
    blockDisplayMode,
    sortColorCounts,
    columnOrder,
    hasRequiredCol,
    imageValid,
    showIds,
    showMaxPerSplit,
    showMaxPerSplitOption,
    showNames,
    showOptions,
    showStacks,
    showUsageInfo,
  ]);

  const colorTableMinWidthPx = useMemo(() => {
    const textureCollapsed = blockDisplayMode === "textures" && !blockColExpanded;
    const blockColWidthPx = textureCollapsed ? blockTextureCollapsedWidthPx : blockColMinWidthPx;
    const sectionInsetsPx = COLOR_TABLE_SECTION_HORIZONTAL_INSETS_PX;
    const fixedColsPx =
      COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.clr +
      COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.id +
      COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.name +
      COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.options +
      requiredColWidth;
    const gapsPx = 5 * COLOR_TABLE_GRID_GAP_PX;
    const gridMinWidthPx = fixedColsPx + blockColWidthPx + gapsPx + sectionInsetsPx;
    return Math.max(
      gridMinWidthPx,
      colorTableHeaderMinWidthPx + COLOR_TABLE_HEADER_GROUP_GAP_PX + sectionInsetsPx,
    );
  }, [
    blockColExpanded,
    blockColMinWidthPx,
    blockDisplayMode,
    blockTextureCollapsedWidthPx,
    colorTableHeaderMinWidthPx,
    requiredColWidth,
  ]);

  useLayoutEffect(() => {
    onMinWidthChange(colorTableMinWidthPx);
  }, [colorTableMinWidthPx, onMinWidthChange]);

  const effectiveBlockColWidthPx = useMemo(
    () => (blockDisplayMode === "textures" && !blockColExpanded ? blockTextureCollapsedWidthPx : blockColMinWidthPx),
    [blockDisplayMode, blockColExpanded, blockColMinWidthPx, blockTextureCollapsedWidthPx],
  );

  useLayoutEffect(() => {
    onLayoutChange({
      blockWidthPx: effectiveBlockColWidthPx,
      requiredWidthPx: requiredColWidth,
      blockExpanded: blockColExpanded,
    });
  }, [blockColExpanded, effectiveBlockColWidthPx, onLayoutChange, requiredColWidth]);

  const gridColsStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: visibleColumns
        .map(column => {
          const columnWidthMap: Record<ColumnId, string> = {
            clr: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.clr}px`,
            id: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.id}px`,
            name: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.name}px`,
            block: blockColExpanded ? `minmax(${effectiveBlockColWidthPx}px,1fr)` : `${effectiveBlockColWidthPx}px`,
            options: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.options}px`,
            required: `${requiredColWidth}px`,
          };
          return columnWidthMap[column];
        })
        .join(" "),
    }),
    [blockColExpanded, effectiveBlockColWidthPx, requiredColWidth, visibleColumns],
  );

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      sortDir === "asc" ? setSortDir("desc") : (setSortKey("default"), setSortDir("asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }, [setSortDir, setSortKey, sortDir, sortKey]);

  const sortArrow = useCallback(
    (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""),
    [sortDir, sortKey],
  );

  const updateDragColumnIndicator = useCallback((next: ColumnDragIndicator | null) => {
    dragColumnIndicatorRef.current = next;
    setDragColumnIndicator(prev =>
      prev?.target === next?.target && prev?.side === next?.side ? prev : next,
    );
  }, []);

  const commitColumnReorder = useCallback((from: ColumnId, indicator: ColumnDragIndicator) => {
    setColumnOrder(prev =>
      wouldReorderColumnOrder(prev, from, indicator)
        ? reorderColumnOrder(prev, from, indicator.target, indicator.side)
        : prev,
    );
  }, [setColumnOrder]);

  const getBlockGroups = useCallback((idx: number) => {
    const excluded = showExcludedBlocks ? EXCLUDED_BLOCKS[idx] ?? [] : [];
    const extra = customBlocksByBase[idx] || [];
    const selected = selectedBlocks[idx] || "";
    const regular = [
      ...BASE_COLORS[idx].blocks,
      ...excluded.filter(block => !BASE_COLORS[idx].blocks.includes(block)),
    ];
    const withBelowPlatformWater = [
      ...regular,
      ...getConditionalBaseBlocks(idx, belowPlatformWater).filter(block => !regular.includes(block)),
    ];
    const custom = extra.filter(block => !withBelowPlatformWater.includes(block));
    if (selected && !withBelowPlatformWater.includes(selected) && !custom.includes(selected)) {
      withBelowPlatformWater.push(selected);
    }
    return {
      regular: withBelowPlatformWater,
      custom,
      all: [...withBelowPlatformWater, ...custom],
    };
  }, [belowPlatformWater, customBlocksByBase, selectedBlocks, showExcludedBlocks]);

  const getColorSwatchShades = useCallback((idx: number): Shade[] => {
    return [...getOrderedSwatchShades(imageValid, usedShadesByColorKey.get(getBaseColorKey(idx)))] as Shade[];
  }, [imageValid, usedShadesByColorKey, getBaseColorKey]);

  const getColorSwatchStyle = useCallback((idx: number): CSSProperties => {
    const shades = getColorSwatchShades(idx);
    return getMultiShadeSwatchStyle(shades.map(shade => getShadedRgb({ id: idx, shade })));
  }, [getColorSwatchShades]);

  const queueSwatchTooltip = useCallback((next: SwatchTooltip | null) => {
    swatchTooltipPendingRef.current = next;
    if (swatchTooltipRafRef.current !== null) return;
    swatchTooltipRafRef.current = requestAnimationFrame(() => {
      swatchTooltipRafRef.current = null;
      const pending = swatchTooltipPendingRef.current;
      setSwatchTooltip(prev => {
        if (!pending && !prev) return prev;
        if (!pending || !prev) return pending;
        if (
          pending.text === prev.text &&
          pending.accentText === prev.accentText &&
          Math.abs(pending.x - prev.x) < 0.5 &&
          Math.abs(pending.y - prev.y) < 0.5
        ) {
          return prev;
        }
        return pending;
      });
    });
  }, []);

  const getShadeTooltip = useCallback((idx: number, shade: Shade): { text: string; accentText?: string } => {
    const [r, g, b] = getShadedRgb({ id: idx, shade });
    const hex = formatSwatchHex(r, g, b);
    const shadeCount = shadeCountsByColorKey.get(getBaseColorKey(idx))?.get(shade) ?? 0;
    return {
      text: messages.swatches.shadeTooltip(hex, shade),
      accentText: getSwatchRequiredAccentText(imageValid, hasRequiredCol, shadeCount, formatRequiredCount),
    };
  }, [shadeCountsByColorKey, getBaseColorKey, imageValid, hasRequiredCol, formatRequiredCount]);

  const handleSwatchTooltip = useCallback((event: React.MouseEvent<HTMLDivElement>, idx: number, swatchShades: Shade[]) => {
    const shade = getShadeAtPointer(event.clientY, event.currentTarget.getBoundingClientRect(), swatchShades);
    const tooltip = getShadeTooltip(idx, shade);
    queueSwatchTooltip({
      text: tooltip.text,
      accentText: tooltip.accentText,
      x: event.clientX + SWATCH_TOOLTIP_OFFSET_PX,
      y: event.clientY + SWATCH_TOOLTIP_OFFSET_PX,
    });
  }, [getShadeTooltip, queueSwatchTooltip]);

  useLayoutEffect(() => {
    return () => {
      if (swatchTooltipRafRef.current !== null) {
        cancelAnimationFrame(swatchTooltipRafRef.current);
        swatchTooltipRafRef.current = null;
      }
    };
  }, []);

  const renderColorRow = useCallback((idx: number) => {
    const color = BASE_COLORS[idx];
    const swatchShades = getColorSwatchShades(idx);
    const isMissing = missingColorKeys.has(getBaseColorKey(idx));
    const { all: allBlocks, regular: regularBlocks, custom: customBlocks } = getBlockGroups(idx);
    const selectedBlock = selectedBlocks[idx] || "";
    const selectedIsIceWater = idx === WATER_BASE_INDEX && normalizeBlockId(selectedBlock) === "ice";
    const selectedIsCustomOption = customBlocks.includes(selectedBlock);
    const textureCollapsed = blockDisplayMode === "textures" && !blockColExpanded;
    const displayCustomBlocks = textureCollapsed
      ? (selectedBlock !== "" && selectedIsCustomOption ? [selectedBlock] : [])
      : customBlocks.toSorted();
    const reqCount = getBaseDisplayRequiredCount(idx);
    const cells: Record<ColumnId, React.ReactNode> = {
      clr: idx === TRANSPARENCY_BASE_INDEX ? (
        <div
          key="clr"
          className="w-5 h-5 rounded border border-border transition-shadow"
          onMouseEnter={event =>
            queueSwatchTooltip({
              text: messages.swatches.transparent,
              x: event.clientX + SWATCH_TOOLTIP_OFFSET_PX,
              y: event.clientY + SWATCH_TOOLTIP_OFFSET_PX,
            })
          }
          onMouseMove={event =>
            queueSwatchTooltip({
              text: messages.swatches.transparent,
              x: event.clientX + SWATCH_TOOLTIP_OFFSET_PX,
              y: event.clientY + SWATCH_TOOLTIP_OFFSET_PX,
            })
          }
          onMouseLeave={() => queueSwatchTooltip(null)}
        >
          <PackedBlockIcon
            atlasKey="world_border"
            atlasName="primary"
            alt={messages.swatches.transparent}
            className="w-full h-full"
          />
        </div>
      ) : (
        <div
          key="clr"
          className="w-5 h-5 rounded border border-border cursor-pointer hover:ring-1 hover:ring-primary/50 transition-shadow"
          style={getColorSwatchStyle(idx)}
          onMouseEnter={event => handleSwatchTooltip(event, idx, swatchShades)}
          onMouseMove={event => handleSwatchTooltip(event, idx, swatchShades)}
          onMouseLeave={() => queueSwatchTooltip(null)}
          onClick={event => {
            const shade = getShadeAtPointer(event.clientY, event.currentTarget.getBoundingClientRect(), swatchShades);
            const [r, g, b] = getShadedRgb({ id: idx, shade });
            onCopyColorToClipboard(r, g, b);
          }}
        />
      ),
      id: (
        <span key="id" className="text-[10px] font-mono text-muted-foreground text-center tabular-nums -ml-[0.3em]">
          {String(idx).padStart(2, "\u2007")}
        </span>
      ),
      name: (
        <span key="name" className="text-[10px] font-mono text-muted-foreground truncate">
          {color.name}
        </span>
      ),
      block: blockDisplayMode === "names" ? (
        <select
          key="block"
          ref={idx === usedIndices[0] ? blockMeasureSelectRef : undefined}
          className={`bg-input border rounded px-1 h-6 text-[11px] font-mono text-foreground min-w-0 w-full ${
            selectedIsIceWater ? "border-warning/60 bg-warning/10" : "border-border"
          }`}
          value={selectedBlocks[idx] || ""}
          onChange={event => onUpdateBlock(idx, event.target.value)}
          title={
            selectedBlock
              ? selectedIsIceWater
                ? messages.blocks.iceWaterOptionTitle(selectedBlock)
                : selectedBlock
              : undefined
          }
        >
          <option value="">{messages.common.none}</option>
          {regularBlocks.toSorted().map(block => (
            <option
              key={block}
              value={block}
              title={idx === WATER_BASE_INDEX && normalizeBlockId(block) === "ice" ? messages.blocks.iceWaterOptionTitle(block) : block}
            >
              {block}
            </option>
          ))}
          {customBlocks.length > 0 && <option disabled value="__custom-divider__">──────── custom ────────</option>}
          {customBlocks.toSorted().map(block => (
            <option key={block} value={block} title={block}>
              {block}
            </option>
          ))}
        </select>
      ) : (
        <div key="block" className="min-w-0 h-6">
          <div
            className={`flex items-center gap-0.5 h-6 min-w-0 px-0.5 ${
              textureCollapsed ? "justify-center overflow-x-hidden" : "overflow-x-auto"
            }`}
          >
            {(!textureCollapsed || selectedBlock === "") && (
              <button
                type="button"
                className={`shrink-0 w-5 h-5 rounded border text-[10px] leading-none ${
                  textureCollapsed
                    ? "border-border text-muted-foreground"
                    : selectedBlock === ""
                      ? "border-transparent text-foreground shadow-[0_0_0_2px_hsl(var(--primary))]"
                      : "border-border text-muted-foreground hover:text-foreground hover:shadow-[0_0_0_1px_hsl(var(--primary))]"
                }`}
                title={messages.common.none}
                onClick={() => onUpdateBlock(idx, "")}
              >
                {messages.common.clearSelectionSymbol}
              </button>
            )}
            {(textureCollapsed ? (selectedBlock !== "" && !selectedIsCustomOption ? [selectedBlock] : []) : regularBlocks).map(block => {
              const selected = selectedBlock === block;
              const isIceWaterOption = idx === WATER_BASE_INDEX && normalizeBlockId(block) === "ice";
              const iconAsset = getBlockIconAsset(block);
              return (
                <button
                  key={block}
                  type="button"
                  className={`shrink-0 w-5 h-5 rounded border overflow-hidden ${
                    textureCollapsed
                      ? "border-border"
                      : selected
                        ? isIceWaterOption
                          ? "border-transparent shadow-[0_0_0_2px_hsl(var(--warning))]"
                          : "border-transparent shadow-[0_0_0_2px_hsl(var(--primary))]"
                        : isIceWaterOption
                          ? "border-border hover:shadow-[0_0_0_1px_hsl(var(--warning))]"
                          : "border-border hover:shadow-[0_0_0_1px_hsl(var(--primary))]"
                  }`}
                  title={isIceWaterOption ? messages.blocks.iceWaterOptionTitle(block) : block}
                  onClick={() => onUpdateBlock(idx, block)}
                >
                  <PackedBlockIcon
                    atlasKey={iconAsset.atlasKey}
                    atlasName={iconAsset.atlasName}
                    alt={block}
                    className="w-full h-full"
                  />
                </button>
              );
            })}
            {displayCustomBlocks.length > 0 && (
              <div className={CUSTOM_OPTION_GROUP_CLASS}>
                {displayCustomBlocks.map(block => {
                  const selected = selectedBlock === block;
                  const iconAsset = getBlockIconAsset(block);
                  return (
                    <button
                      key={block}
                      type="button"
                      className={`shrink-0 w-5 h-5 rounded border overflow-hidden ${
                        selected
                          ? "border-transparent shadow-[0_0_0_2px_hsl(var(--primary))]"
                          : "border-border hover:shadow-[0_0_0_1px_hsl(var(--primary))]"
                      }`}
                      title={`custom: ${block}`}
                      onClick={() => onUpdateBlock(idx, block)}
                    >
                      <PackedBlockIcon
                        atlasKey={iconAsset.atlasKey}
                        atlasName={iconAsset.atlasName}
                        alt={block}
                        className="w-full h-full"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ),
      options: (
        <span key="options" className="text-[10px] text-muted-foreground whitespace-nowrap text-center tabular-nums">
          {String(allBlocks.length).padStart(2, "\u2007")}
        </span>
      ),
      required: (
        <span key="required" className="text-[10px] font-mono text-right pr-2">
          {reqCount > 0 ? (showStacks ? formatStacks(reqCount) : reqCount) : ""}
        </span>
      ),
    };

    return (
      <div
        key={idx}
        className={`grid gap-1 items-center py-px text-xs transition-colors min-w-0 ${
          isMissing ? "relative z-[1] rounded" : ""
        }`}
        style={gridColsStyle}
      >
        {isMissing && (
          <div className="pointer-events-none absolute inset-y-0 -left-[3px] -right-[2px] rounded border border-destructive/60 bg-destructive/30" />
        )}
        {visibleColumns.map(column => cells[column])}
      </div>
    );
  }, [
    blockColExpanded,
    blockDisplayMode,
    displayColorCounts,
    getBlockGroups,
    getBaseColorKey,
    getBaseDisplayRequiredCount,
    getBlockIconAsset,
    getColorSwatchShades,
    getColorSwatchStyle,
    gridColsStyle,
    handleSwatchTooltip,
    missingColorKeys,
    onCopyColorToClipboard,
    onUpdateBlock,
    queueSwatchTooltip,
    selectedBlocks,
    showStacks,
    visibleColumns,
  ]);

  return (
    <>
      <section
        className={`relative bg-card border border-border rounded-md pt-2 pr-2 pb-1 pl-2 w-full ${
          isStackedLayout ? "" : "min-w-[var(--color-table-min-width)]"
        }`}
      >
        <div ref={colorTableHeaderRef} className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <h2 className={`${PANEL_TITLE_TEXT_CLASS} cursor-help whitespace-nowrap`} title={messages.table.titleTooltip}>
              {messages.table.title}
            </h2>
            <span className="h-3 border-l border-border/70" />
            <button
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowIds(value => !value)}
            >
              {showIds ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
              {messages.table.toggleIds}
            </button>
            <span className="h-3 border-l border-border/70" />
            <button
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowNames(value => !value)}
            >
              {showNames ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
              {messages.table.toggleNames}
            </button>
            <span className="h-3 border-l border-border/70" />
            <button
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowOptions(value => !value)}
            >
              {showOptions ? <Minus size={10} className="text-destructive" /> : <Plus size={10} className="text-green-500" />}
              {messages.table.toggleOptions}
            </button>
            <span className="h-3 border-l border-border/70" />
            <button
              className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setBlockDisplayMode(value => (value === "names" ? "textures" : "names"))}
              title={messages.table.toggleBlockDisplayTitle}
            >
              <Glasses aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
              {messages.table.blockDisplayMode(blockDisplayMode)}
            </button>
          </div>
          {showUsageInfo && hasRequiredCol && (
            <div className="flex items-center gap-1.5">
              {showMaxPerSplitOption && (
                <label
                  className={MUTED_INLINE_TOGGLE_CONTROL_CLASS}
                  title={messages.table.maxPerSplitTooltip}
                >
                  <span>{messages.table.maxPerSplitLabel}</span>
                  <input
                    type="checkbox"
                    checked={showMaxPerSplit}
                    onChange={event => setShowMaxPerSplit(event.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                </label>
              )}
              {showMaxPerSplitOption && <span className="h-3 border-l border-border/70" />}
              <label
                className={MUTED_INLINE_TOGGLE_CONTROL_CLASS}
                title={messages.table.mcUnitsTooltip}
              >
                <span>{messages.table.mcUnitsLabel}</span>
                <input
                  type="checkbox"
                  checked={showStacks}
                  onChange={event => setShowStacks(event.target.checked)}
                  className="h-3.5 w-3.5"
                />
              </label>
            </div>
          )}
        </div>
        <div key={`${showIds}-${showNames}-${showOptions}-${columnOrder.join(",")}`} className="relative">
          <div className="relative">
            {hasRequiredCol && usedIndices.length > 0 && visibleColumns.includes("required") && (
              <div className="absolute inset-0 pointer-events-none grid gap-1" style={gridColsStyle}>
                {visibleColumns.map(column => (
                  <div
                    key={`required-outline-${column}`}
                    className={column === "required" ? "mx-px border-2 border-primary/60 bg-primary/10 rounded" : ""}
                  />
                ))}
              </div>
            )}
            <div
              className="grid gap-1 text-[10px] font-semibold leading-none text-muted-foreground bg-card pt-1 pb-1"
              style={gridColsStyle}
            >
              {visibleColumns.map(column => {
                const headerMap: Record<ColumnId, React.ReactNode> = {
                  clr: (
                    <span
                      key="clr"
                      className="cursor-pointer select-none whitespace-nowrap"
                      onClick={() => toggleSort("color")}
                      title={messages.table.columnSortTitle("clr")}
                    >
                      {messages.table.columnLabel("clr")}
                      {sortArrow("color")}
                    </span>
                  ),
                  id: (
                    <span
                      key="id"
                      className="cursor-pointer select-none whitespace-nowrap pl-0.5"
                      onClick={() => toggleSort("id")}
                      title={messages.table.columnSortTitle("id")}
                    >
                      {messages.table.columnLabel("id")}
                      {sortArrow("id")}
                    </span>
                  ),
                  name: (
                    <span
                      key="name"
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort("name")}
                      title={messages.table.columnSortTitle("name")}
                    >
                      {messages.table.columnLabel("name")}
                      {sortArrow("name")}
                    </span>
                  ),
                  block: (
                    <span key="block" className="inline-flex items-center gap-1 min-w-0 w-full" title={messages.table.columnSortTitle("block")}>
                      <button
                        ref={blockHeaderCollapseBtnRef}
                        type="button"
                        className="shrink-0 inline-flex items-center gap-0.5 cursor-pointer select-none whitespace-nowrap text-left"
                        title={messages.table.blockColumnResizeTitle(blockColExpanded)}
                        aria-label={messages.table.blockColumnResizeAriaLabel(blockColExpanded)}
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          setBlockColExpanded(value => !value);
                        }}
                      >
                        <span>{messages.table.columnLabel("block")}</span>
                        {blockColExpanded ? <PanelRightClose size={11} /> : <PanelRightOpen size={11} />}
                      </button>
                    </span>
                  ),
                  options: (
                    <span
                      key="options"
                      className="cursor-pointer select-none whitespace-nowrap pl-0.5"
                      onClick={() => toggleSort("options")}
                      title={messages.table.columnSortTitle("options")}
                    >
                      {messages.table.columnLabel("options")}
                      {sortKey === "options" ? sortArrow("options") : <span className="invisible"> ▲</span>}
                    </span>
                  ),
                  required: (
                    <span
                      key="required"
                      className="block w-full cursor-pointer select-none whitespace-nowrap text-right pr-2"
                      onClick={() => toggleSort("required")}
                      title={messages.table.columnSortTitle("required")}
                    >
                      {messages.table.columnLabel("required")}
                      {sortKey === "required" ? sortArrow("required") : <span className="invisible"> ▲</span>}
                    </span>
                  ),
                };

                const dropIndicatorSide = dragColumnIndicator?.target === column ? dragColumnIndicator.side : null;
                return (
                  <div
                    key={column}
                    className="relative min-w-0"
                    draggable
                    onDragStart={event => {
                      dragColRef.current = column;
                      updateDragColumnIndicator(null);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", column);
                    }}
                    onDragOver={event => {
                      const from = dragColRef.current;
                      if (!from) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const rect = event.currentTarget.getBoundingClientRect();
                      const side: ColumnDropSide = event.clientX >= rect.left + rect.width / 2 ? "after" : "before";
                      const normalized = normalizeColumnDropTarget(columnOrder, column, side);
                      const nextIndicator = normalized && wouldReorderColumnOrder(columnOrder, from, normalized)
                        ? normalized
                        : null;
                      updateDragColumnIndicator(nextIndicator);
                    }}
                    onDragEnd={() => {
                      const from = dragColRef.current;
                      const indicator = dragColumnIndicatorRef.current;
                      if (from && indicator) {
                        commitColumnReorder(from, indicator);
                      }
                      dragColRef.current = null;
                      updateDragColumnIndicator(null);
                    }}
                  >
                    {dropIndicatorSide && (
                      <div
                        className={`absolute top-0 bottom-0 z-10 w-0.5 bg-primary pointer-events-none ${
                          dropIndicatorSide === "after" ? "right-0" : "left-0"
                        }`}
                      />
                    )}
                    {headerMap[column]}
                  </div>
                );
              })}
            </div>
            <div className="border-t border-border mb-[3px]" />
            <div className="relative">{usedIndices.map(renderColorRow)}</div>
          </div>

          {imageValid && unusedIndices.length > 0 && (
            <div>
              <div className="border-t border-border mt-[3px]" />
              <button
                className="w-full flex items-center gap-1 pt-1 pb-0.5 leading-none text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowUnusedColors(value => !value)}
              >
                <span className={`inline-block transition-transform ${showUnusedColors ? "rotate-180" : ""}`}>▼</span>
                <span>{messages.table.unusedColorsLabel(unusedIndices.length)}</span>
              </button>
              {showUnusedColors && <div className="opacity-50">{unusedIndices.map(renderColorRow)}</div>}
            </div>
          )}
        </div>
      </section>
      {swatchTooltip && (
        <div
          className="fixed z-50 pointer-events-none px-1.5 py-1 rounded border border-border bg-popover text-popover-foreground text-[10px] font-mono whitespace-nowrap"
          style={{ left: swatchTooltip.x, top: swatchTooltip.y }}
        >
          <span>{swatchTooltip.text}</span>
          {swatchTooltip.accentText && <span className="text-primary">{swatchTooltip.accentText}</span>}
        </div>
      )}
    </>
  );
}
