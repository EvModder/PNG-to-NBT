/**
 * Public API:
 * - PanelCustomColors()
 *
 * Callers:
 * - src/Index.tsx
 */
import {
  cloneElement,
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { X } from "lucide-react";
import { BASE_COLORS, Shade } from "@/data/mapColors";
import { getBlockIconAsset } from "@/lib/blockIconAtlas";
import { getColorRefCount, getColorRefKey, type ColorRefKey } from "@/lib/colorRefs";
import { messages } from "@/lib/messages";
import type { ColorRef, ColorRgb } from "@/types/color";
import type { BlockDisplayMode, ColumnId, SortDir, SortKey } from "@/types/ui";
import { findMatchingBaseColorIndex, getSelectedCustomColorBlock } from "@/utils/customColors";
import { getHue, getShadedRgb } from "@/utils/color";
import {
  SWATCH_TOOLTIP_OFFSET_PX,
  formatSwatchHex,
  getMultiShadeSwatchStyle,
  getOrderedSwatchShades,
  getShadeAtPointer,
  getSwatchRequiredAccentText,
} from "@/utils/colorSwatch";
import { COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX } from "@/utils/colorTableLayout";
import { PANEL_TITLE_TEXT_CLASS } from "@/utils/uiTypography";
import { PackedBlockIcon } from "@/components/PackedBlockIcon";

type NewCustomColorDraft = {
  r: string;
  g: string;
  b: string;
  block: string;
};

type PanelCustomColorsProps = {
  isStackedLayout: boolean;
  customColors: ColorRgb[];
  selectedBlocksCustom: Readonly<Record<number, string>>;
  selectedBlocks: Record<number, string>;
  columnOrder: ColumnId[];
  blockColumnWidthPx: number;
  requiredColumnWidthPx: number;
  blockColumnExpanded: boolean;
  blockDisplayMode: BlockDisplayMode;
  sortKey: SortKey;
  sortDir: SortDir;
  customMode: "custom" | number;
  setCustomMode: Dispatch<SetStateAction<"custom" | number>>;
  newCustom: NewCustomColorDraft;
  onCustomChannelChange: (channel: "r" | "g" | "b", value: string) => void;
  onCustomBlockChange: (value: string) => void;
  onCustomBlockCommit: () => void;
  addCustomColor: () => void;
  onUpdateBlock: (baseIndex: number, block: string) => void;
  onSelectCustomBlock: (customIndex: number, block: string) => void;
  onRemoveCustomBlock: (customIndex: number, block: string, baseIndex: number | null) => void;
  onCopyColorToClipboard: (r: number, g: number, b: number) => void;
  colorCounts: Readonly<Record<string, number>>;
  formatRequiredCount: (count: number) => string | number;
  usedShadesByColorKey: ReadonlyMap<ColorRefKey, ReadonlySet<Shade>>;
  shadeCountsByColorKey: ReadonlyMap<ColorRefKey, ReadonlyMap<Shade, number>>;
  missingColorKeys: ReadonlySet<ColorRefKey>;
  imageValid: boolean;
  hasRequiredCol: boolean;
  showIds: boolean;
  showNames: boolean;
  showOptions: boolean;
};

type SwatchTooltip = {
  text: string;
  accentText?: string;
  x: number;
  y: number;
};

type CustomColorRow = {
  customIndex: number;
  color: ColorRgb;
  baseIndex: number | null;
};

function getRowColorRef(row: CustomColorRow): ColorRef {
  return row.baseIndex === null ? { id: row.customIndex, isCustom: true } : { id: row.baseIndex, isCustom: false };
}

type CustomColumnId = Extract<ColumnId, "clr" | "id" | "name" | "block" | "options" | "required">;

const CUSTOM_TITLE_TEXT_CLASS = `${PANEL_TITLE_TEXT_CLASS} text-cyan-700 dark:text-cyan-300`;
const CUSTOM_VISIBLE_COLUMNS = new Set<CustomColumnId>(["clr", "id", "name", "block", "options", "required"]);
const REMOVE_BUTTON_CLASS =
  "relative shrink-0 h-6 w-6 rounded border border-border bg-input text-destructive hover:text-foreground hover:border-destructive/60";
const REMOVE_ICON_CLASS = "absolute inset-0 m-auto h-3.5 w-3.5";

function isCustomColumnId(column: ColumnId): column is CustomColumnId {
  return CUSTOM_VISIBLE_COLUMNS.has(column as CustomColumnId);
}

function buildRowGridTemplate(
  columns: readonly CustomColumnId[],
  blockColumnWidthPx: number,
  requiredColumnWidthPx: number,
  blockColumnExpanded: boolean,
): string {
  const columnWidthMap: Record<CustomColumnId, string> = {
    clr: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.clr}px`,
    id: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.id}px`,
    name: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.name}px`,
    block: blockColumnExpanded ? `minmax(${blockColumnWidthPx}px,1fr)` : `${blockColumnWidthPx}px`,
    options: `${COLOR_TABLE_FIXED_COLUMN_WIDTHS_PX.options}px`,
    required: `${requiredColumnWidthPx}px`,
  };
  return columns.map(column => columnWidthMap[column]).join(" ");
}

function SectionDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`h-[7px] flex items-center ${className}`}>
      <div className="w-full border-t border-border" />
    </div>
  );
}

function sortCustomRows(
  rows: readonly CustomColorRow[],
  sortKey: SortKey,
  sortDir: SortDir,
  getRequiredCount: (row: CustomColorRow) => number,
): CustomColorRow[] {
  if (sortKey === "default") return [...rows];
  const dir = sortDir === "asc" ? 1 : -1;
  return rows.toSorted((a, b) => {
    switch (sortKey) {
      case "id":
        if (a.baseIndex === null || b.baseIndex === null) return a.customIndex - b.customIndex;
        return dir * (a.baseIndex - b.baseIndex);
      case "name": {
        const aName = a.baseIndex === null ? "" : BASE_COLORS[a.baseIndex].name;
        const bName = b.baseIndex === null ? "" : BASE_COLORS[b.baseIndex].name;
        return dir * aName.localeCompare(bName);
      }
      case "color":
        return dir * (getHue(a.color.r, a.color.g, a.color.b) - getHue(b.color.r, b.color.g, b.color.b));
      case "options":
        return dir * (a.color.blocks.length - b.color.blocks.length);
      case "required":
        return dir * (getRequiredCount(a) - getRequiredCount(b));
      default:
        return a.customIndex - b.customIndex;
    }
  });
}

// Callers:
// - src/Index.tsx
export function PanelCustomColors({
  isStackedLayout,
  customColors,
  selectedBlocksCustom,
  selectedBlocks,
  columnOrder,
  blockColumnWidthPx,
  requiredColumnWidthPx,
  blockColumnExpanded,
  blockDisplayMode,
  sortKey,
  sortDir,
  customMode,
  setCustomMode,
  newCustom,
  onCustomChannelChange,
  onCustomBlockChange,
  onCustomBlockCommit,
  addCustomColor,
  onUpdateBlock,
  onSelectCustomBlock,
  onRemoveCustomBlock,
  onCopyColorToClipboard,
  colorCounts,
  formatRequiredCount,
  usedShadesByColorKey,
  shadeCountsByColorKey,
  missingColorKeys,
  imageValid,
  hasRequiredCol,
  showIds,
  showNames,
  showOptions,
}: PanelCustomColorsProps) {
  const [showUnusedCustomColors, setShowUnusedCustomColors] = useState(false);
  const [swatchTooltip, setSwatchTooltip] = useState<SwatchTooltip | null>(null);
  const getRowColorKey = useCallback((row: CustomColorRow) => getColorRefKey(getRowColorRef(row)), []);
  const getRowRequiredCount = useCallback((row: CustomColorRow) => getColorRefCount(colorCounts, getRowColorRef(row)), [colorCounts]);
  const isRowUsed = useCallback((row: CustomColorRow) => usedShadesByColorKey.has(getRowColorKey(row)), [usedShadesByColorKey, getRowColorKey]);

  const visibleColumns = useMemo(
    () =>
      columnOrder.filter((column): column is CustomColumnId => {
        if (!isCustomColumnId(column)) return false;
        if (column === "id" && !showIds) return false;
        if (column === "name" && !showNames) return false;
        if (column === "options" && !showOptions) return false;
        if (column === "required" && !hasRequiredCol) return false;
        return true;
      }),
    [columnOrder, showIds, showNames, showOptions, hasRequiredCol],
  );

  const rowGridTemplate = useMemo(
    () => buildRowGridTemplate(visibleColumns, blockColumnWidthPx, requiredColumnWidthPx, blockColumnExpanded),
    [visibleColumns, blockColumnWidthPx, requiredColumnWidthPx, blockColumnExpanded],
  );

  const { baseRows, usedCustomRows, unusedCustomRows } = useMemo(() => {
    const rows: CustomColorRow[] = customColors.map((color, customIndex) => ({
      customIndex,
      color,
      baseIndex: findMatchingBaseColorIndex(color),
    }));

    const baseRows = sortCustomRows(
      rows.filter(row => row.baseIndex !== null) as Array<CustomColorRow & { baseIndex: number }>,
      sortKey,
      sortDir,
      getRowRequiredCount,
    );
    const trueCustomRows = rows.filter(row => row.baseIndex === null);
    if (!imageValid) {
      return {
        baseRows,
        usedCustomRows: sortCustomRows(trueCustomRows, sortKey, sortDir, getRowRequiredCount),
        unusedCustomRows: [] as CustomColorRow[],
      };
    }

    return {
      baseRows,
      usedCustomRows: sortCustomRows(
        trueCustomRows.filter(isRowUsed),
        sortKey,
        sortDir,
        getRowRequiredCount,
      ),
      unusedCustomRows: sortCustomRows(
        trueCustomRows.filter(row => !isRowUsed(row)),
        sortKey,
        sortDir,
        getRowRequiredCount,
      ),
    };
  }, [customColors, getRowRequiredCount, imageValid, isRowUsed, sortDir, sortKey]);

  const getShadeCount = useCallback(
    (row: CustomColorRow, shade: Shade) =>
      shadeCountsByColorKey.get(getRowColorKey(row))?.get(shade) ?? 0,
    [shadeCountsByColorKey, getRowColorKey],
  );

  const setTooltipFromShade = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, hex: string, shade: Shade, accentText?: string) => {
      setSwatchTooltip({
        text: messages.swatches.shadeTooltip(hex, shade),
        accentText,
        x: event.clientX + SWATCH_TOOLTIP_OFFSET_PX,
        y: event.clientY + SWATCH_TOOLTIP_OFFSET_PX,
      });
    },
    [],
  );

  const renderSwatch = useCallback((
    row: CustomColorRow,
    swatchShades: readonly Shade[],
    rgbForShade: (shade: Shade) => [number, number, number],
    title: string | undefined,
  ) => {
    const swatchColors = swatchShades.map(shade => rgbForShade(shade));
    return (
      <button
        type="button"
        className="w-5 h-5 rounded border border-border cursor-pointer hover:ring-1 hover:ring-primary/50 transition-shadow"
        style={getMultiShadeSwatchStyle(swatchColors)}
        onMouseEnter={event => {
          const shade = getShadeAtPointer(event.clientY, event.currentTarget.getBoundingClientRect(), swatchShades);
          const [r, g, b] = rgbForShade(shade);
          const shadeCount = getShadeCount(row, shade);
          setTooltipFromShade(
            event,
            formatSwatchHex(r, g, b),
            shade,
            getSwatchRequiredAccentText(imageValid, hasRequiredCol, shadeCount, formatRequiredCount),
          );
        }}
        onMouseMove={event => {
          const shade = getShadeAtPointer(event.clientY, event.currentTarget.getBoundingClientRect(), swatchShades);
          const [r, g, b] = rgbForShade(shade);
          const shadeCount = getShadeCount(row, shade);
          setTooltipFromShade(
            event,
            formatSwatchHex(r, g, b),
            shade,
            getSwatchRequiredAccentText(imageValid, hasRequiredCol, shadeCount, formatRequiredCount),
          );
        }}
        onMouseLeave={() => setSwatchTooltip(null)}
        onClick={event => {
          const shade = getShadeAtPointer(event.clientY, event.currentTarget.getBoundingClientRect(), swatchShades);
          const [r, g, b] = rgbForShade(shade);
          onCopyColorToClipboard(r, g, b);
        }}
        title={title}
      />
    );
  }, [formatRequiredCount, getShadeCount, hasRequiredCol, imageValid, onCopyColorToClipboard, setTooltipFromShade]);

  const renderRow = useCallback((row: CustomColorRow, showRequired: boolean) => {
    const isBaseRow = row.baseIndex !== null;
    const selectedBlock = isBaseRow
      ? (selectedBlocks[row.baseIndex] ?? "")
      : getSelectedCustomColorBlock(selectedBlocksCustom, row.customIndex, customColors);
    const swatchShades = getOrderedSwatchShades(imageValid, usedShadesByColorKey.get(getRowColorKey(row)));

    const swatch = row.baseIndex === null
      ? renderSwatch(
          row,
          swatchShades,
          shade => getShadedRgb(row.color, shade as Shade.Dark | Shade.Flat | Shade.Light),
          selectedBlock || undefined,
        )
      : renderSwatch(row, swatchShades, shade => getShadedRgb({ id: row.baseIndex, shade }), selectedBlock || undefined);

    const requiredText =
      showRequired && getRowRequiredCount(row) > 0
        ? formatRequiredCount(getRowRequiredCount(row))
        : "";
    const isMissing = row.baseIndex === null && missingColorKeys.has(getRowColorKey(row));
    const displayBlocks = row.color.blocks.toSorted();
    const selectedIsListedCustomBlock = displayBlocks.includes(selectedBlock);
    const removableBlock = isBaseRow ? (selectedIsListedCustomBlock ? selectedBlock : "") : selectedBlock;
    const textureCollapsed = blockDisplayMode === "textures" && !blockColumnExpanded;

    const cells: Record<CustomColumnId, ReactNode> = {
      clr: cloneElement(swatch, { key: "clr" }),
      id: (
        <span key="id" className="text-[10px] font-mono text-muted-foreground text-center tabular-nums -ml-[0.3em]">
          {row.baseIndex === null ? "" : String(row.baseIndex).padStart(2, "\u2007")}
        </span>
      ),
      name: (
        <span key="name" className="text-[10px] font-mono text-muted-foreground truncate">
          {row.baseIndex === null ? "" : BASE_COLORS[row.baseIndex].name}
        </span>
      ),
      block: blockDisplayMode === "names" ? (
        <div className="flex items-center gap-0.5 min-w-0 h-6">
          <select
            className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground min-w-0 flex-1"
            value={isBaseRow ? (selectedIsListedCustomBlock ? selectedBlock : "") : selectedBlock}
            onChange={event => (
              isBaseRow && row.baseIndex !== null
                ? onUpdateBlock(row.baseIndex, event.target.value)
                : onSelectCustomBlock(row.customIndex, event.target.value)
            )}
            title={selectedBlock || undefined}
          >
            <option value="">{messages.common.none}</option>
            {displayBlocks.map(block => (
              <option key={block} value={block}>
                {block}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={REMOVE_BUTTON_CLASS}
            title={messages.common.remove}
            onClick={() => removableBlock && onRemoveCustomBlock(row.customIndex, removableBlock, row.baseIndex)}
            disabled={!removableBlock}
          >
            <X className={REMOVE_ICON_CLASS} strokeWidth={2.2} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 min-w-0 h-6">
          <div
            className={`flex-1 flex items-center gap-0.5 h-6 min-w-0 px-0.5 ${
              textureCollapsed ? "justify-center overflow-x-hidden" : "overflow-x-auto"
            }`}
          >
            {!isBaseRow && (!textureCollapsed || !selectedIsListedCustomBlock) && (
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
                onClick={() => (
                  isBaseRow && row.baseIndex !== null
                    ? onUpdateBlock(row.baseIndex, "")
                    : onSelectCustomBlock(row.customIndex, "")
                )}
              >
                {messages.common.clearSelectionSymbol}
              </button>
            )}
            {(textureCollapsed ? (selectedIsListedCustomBlock ? [selectedBlock] : []) : displayBlocks).map(block => {
              const iconAsset = getBlockIconAsset(block);
              const selected = selectedBlock === block;
              return (
                <button
                  key={block}
                  type="button"
                  className={`shrink-0 w-5 h-5 rounded border overflow-hidden ${
                    textureCollapsed
                      ? "border-border"
                      : selected
                        ? "border-transparent shadow-[0_0_0_2px_hsl(var(--primary))]"
                        : "border-border hover:shadow-[0_0_0_1px_hsl(var(--primary))]"
                  }`}
                  title={block}
                  onClick={() => (
                    isBaseRow && row.baseIndex !== null
                      ? onUpdateBlock(row.baseIndex, block)
                      : onSelectCustomBlock(row.customIndex, block)
                  )}
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
          <button
            type="button"
            className={REMOVE_BUTTON_CLASS}
            title={messages.common.remove}
            onClick={() => removableBlock && onRemoveCustomBlock(row.customIndex, removableBlock, row.baseIndex)}
            disabled={!removableBlock}
          >
            <X className={REMOVE_ICON_CLASS} strokeWidth={2.2} />
          </button>
        </div>
      ),
      options: (
        <span key="options" className="text-[10px] text-muted-foreground whitespace-nowrap text-center tabular-nums">
          {String(row.color.blocks.length).padStart(2, "\u2007")}
        </span>
      ),
      required: (
        <span key="required" className="text-[10px] font-mono text-right pr-2">
          {requiredText}
        </span>
      ),
    };

    return (
      <div
        key={row.customIndex}
        className={`grid gap-1 items-center py-px text-xs min-w-0 ${
          isMissing ? "relative z-[1] rounded" : ""
        }`}
        style={{ gridTemplateColumns: rowGridTemplate }}
      >
        {isMissing && (
          <div className="pointer-events-none absolute inset-y-0 -left-[3px] -right-[2px] rounded border border-destructive/60 bg-destructive/30" />
        )}
        {visibleColumns.map(column => cells[column])}
      </div>
    );
  }, [
    blockColumnExpanded,
    blockDisplayMode,
    colorCounts,
    customColors,
    selectedBlocksCustom,
    formatRequiredCount,
    getRowColorKey,
    getRowRequiredCount,
    imageValid,
    onUpdateBlock,
    onRemoveCustomBlock,
    onSelectCustomBlock,
    renderSwatch,
    rowGridTemplate,
    selectedBlocks,
    visibleColumns,
    missingColorKeys,
    usedShadesByColorKey,
  ]);

  return (
    <>
      <section
        className={`bg-card border border-border rounded-md p-2 w-full ${
          isStackedLayout ? "" : "min-w-[var(--color-table-min-width)]"
        }`}
      >
        <div className="flex items-center gap-1 mb-2">
          <h2
            className={`${CUSTOM_TITLE_TEXT_CLASS} cursor-help`}
            title={messages.customColors.tooltip}
            aria-label={messages.customColors.ariaLabel}
          >
            {messages.customColors.title}
          </h2>
        </div>
        {baseRows.length > 0 && (
          <div className={usedCustomRows.length > 0 ? "" : "mb-2"}>
            {baseRows.map(row => renderRow(row, false))}
          </div>
        )}

        {usedCustomRows.length > 0 && (
          <div>
            {baseRows.length > 0 && <SectionDivider />}
            {imageValid && usedCustomRows.length > 0 && (
              <div className="mb-[3px] rounded border border-primary/30 bg-primary/10 px-1.5 py-1 text-[10px] leading-snug text-foreground">
                {messages.customColors.usedInImage(usedCustomRows.length)}
              </div>
            )}
            <div className={`relative ${unusedCustomRows.length > 0 ? "" : "mb-2"}`}>
              {hasRequiredCol && visibleColumns.includes("required") && (
                <div className="absolute inset-0 pointer-events-none grid gap-1" style={{ gridTemplateColumns: rowGridTemplate }}>
                  {visibleColumns.map(column => (
                    <div
                      key={`custom-required-outline-${column}`}
                      className={column === "required" ? "mx-px border-2 border-primary/60 bg-primary/10 rounded" : ""}
                    />
                  ))}
                </div>
              )}
              {usedCustomRows.map(row => renderRow(row, true))}
            </div>
          </div>
        )}

        {imageValid && unusedCustomRows.length > 0 && (
          <div>
            {(baseRows.length > 0 || usedCustomRows.length > 0) && <div className="border-t border-border mt-[3px]" />}
            <button
              className="w-full flex items-center gap-1 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowUnusedCustomColors(value => !value)}
            >
              <span className={`inline-block transition-transform ${showUnusedCustomColors ? "rotate-180" : ""}`}>▼</span>
              <span>{messages.customColors.unusedLabel(unusedCustomRows.length)}</span>
            </button>
            {showUnusedCustomColors && <div className="opacity-50">{unusedCustomRows.map(row => renderRow(row, true))}</div>}
          </div>
        )}

        <div className="mt-1 flex flex-wrap gap-1.5 items-center">
          <select
            className="bg-input border border-border rounded px-1 h-6 text-[11px] font-mono text-foreground w-48"
            value={customMode === "custom" ? "custom" : String(customMode)}
            onChange={e => setCustomMode(e.target.value === "custom" ? "custom" : Number.parseInt(e.target.value, 10))}
          >
            <option value="custom">{messages.customColors.customRgbOption}</option>
            {BASE_COLORS.map((_, idx) => (
              <option key={idx} value={idx}>
                {idx} – {BASE_COLORS[idx].name}
              </option>
            ))}
          </select>
          {customMode === "custom" && (
            <>
              {(["r", "g", "b"] as const).map(channel => (
                <div key={channel} className="flex items-center gap-0.5">
                  <label className="text-[10px] text-muted-foreground">{messages.customColors.channelLabel(channel)}</label>
                  <input
                    className="w-10 h-6 text-[11px] font-mono no-spinner px-1 bg-input border border-border rounded"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={255}
                    value={newCustom[channel]}
                    onChange={e => onCustomChannelChange(channel, e.target.value)}
                  />
                </div>
              ))}
            </>
          )}
          <div className="flex items-center gap-0.5">
            <label className="text-[10px] text-muted-foreground">{messages.customColors.blockLabel}</label>
            <input
              className="w-40 h-6 text-[11px] font-mono px-1 bg-input border border-border rounded"
              placeholder={messages.customColors.blockPlaceholder}
              value={newCustom.block}
              onChange={e => onCustomBlockChange(e.target.value)}
              onBlur={onCustomBlockCommit}
              onKeyDown={event => {
                if (event.key !== "Enter") return;
                onCustomBlockCommit();
                event.currentTarget.blur();
              }}
            />
          </div>
          <button
            className="h-6 px-2 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
            onClick={addCustomColor}
          >
            {messages.common.add}
          </button>
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
