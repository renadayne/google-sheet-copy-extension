// Writes one or more SheetModels to an .xlsx workbook with ExcelJS.

import {
  type Alignment,
  type CellValue as XlsxValue,
  type Font,
  Workbook,
  type Worksheet,
} from 'exceljs';
import type { CellStyle, SheetModel } from '../shared/model';
import {
  downloadBlob,
  exportFileName,
  type ExportOptions,
  isFormula,
  stripControlChars,
  toGrid,
} from './grid';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const WHITE = 'FFFFFFFF';

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/** Converts a CSS colour ("#f00", "#ff0000", "rgb(255, 0, 0)") to ExcelJS ARGB. */
export function cssToArgb(css: string | null): string | null {
  if (!css) return null;
  const value = css.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    return `FF${full}`.toUpperCase();
  }

  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(value);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null; // fully transparent
    return `FF${hex2(Number(rgb[1]))}${hex2(Number(rgb[2]))}${hex2(Number(rgb[3]))}`.toUpperCase();
  }
  return null;
}

/** Formula-bar text -> workbook value: plain numbers become numbers, the rest stays text. */
function toXlsxValue(text: string, { formulas }: ExportOptions): XlsxValue {
  // The formula bar shows a leading apostrophe on cells forced to text ("'+ note").
  // It is a marker, not part of the value.
  if (text.startsWith("'")) return text.slice(1);
  if (formulas && isFormula(text)) return { formula: text.slice(1) };
  // Leading zeros ("007") are kept as text.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function toFont(style: CellStyle): Partial<Font> {
  const font: Partial<Font> = {};
  if (style.fontFamily) font.name = style.fontFamily;
  const size = Number(style.fontSize);
  if (style.fontSize && Number.isFinite(size) && size > 0) font.size = size;
  if (style.bold !== null) font.bold = style.bold;
  if (style.italic !== null) font.italic = style.italic;
  if (style.underline !== null) font.underline = style.underline;
  const color = cssToArgb(style.textColor);
  if (color) font.color = { argb: color };
  return font;
}

/**
 * Sheet names in xlsx are limited to 31 characters, may not contain []:*?/\ and must
 * be unique ignoring case. `taken` holds the lower-cased names already used.
 */
function worksheetName(name: string | null, taken: Set<string>): string {
  const base =
    (name ?? '')
      .replace(/[[\]:*?/\\\p{Cc}]/gu, '_')
      .replace(/^'+|'+$/g, '')
      .slice(0, 31)
      .trim() || 'Sheet';
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** Rough width of a string in Excel's column-width units (one unit is about one digit). */
const textWidth = (text: string) => text.length * 1.15 + 2;

/** Sheets' default column is 100px wide, about 13 of Excel's width units. */
const DEFAULT_COLUMN_WIDTH = 13;
const MAX_COLUMN_WIDTH = 60;
const LINE_HEIGHT_PT = 15;
const MAX_ROW_HEIGHT_PT = 409;

interface Layout {
  /** Whether the cell at this 0-based position should wrap its text. */
  wraps(row: number, col: number): boolean;
  vertical: 'middle' | 'bottom';
  /** Column widths in Excel units, by 0-based column. */
  widths: number[];
  /** Row heights in points, by 0-based row; undefined leaves the default. */
  heights: (number | undefined)[];
}

/**
 * The scan cannot see column widths, row heights, wrapping or vertical alignment,
 * so this reconstructs a layout from the content alone, following how Sheets
 * behaves by default:
 *
 * - Text with nothing to its right spills over the empty cells, as in Sheets, so
 *   it is left unwrapped and does not widen its column.
 * - Text that is boxed in (a neighbour to the right, a merge, or explicit line
 *   breaks) wraps, and its column is sized to its longest line, within limits.
 * - Rows grow to fit wrapped text. Excel does not auto-fit rows that contain
 *   merged cells, hence explicit heights.
 * - A sheet with merged cells is taken to be a laid-out table and centred
 *   vertically; otherwise Sheets' default of bottom alignment is kept.
 */
function planLayout(model: SheetModel): Layout {
  const grid = toGrid(model);
  const lines = (value: string) => stripControlChars(value).replace(/^'/, '').split('\n');
  const occupied = (row: number, col: number) =>
    grid.cellAt(row, col) !== undefined || grid.isCovered(row, col);

  const wrapping = new Set<string>();
  for (const { row, col, value } of model.cells) {
    const merge = grid.mergeAt(row, col);
    const boxedIn = merge !== undefined || value.includes('\n') || occupied(row, col + 1);
    if (boxedIn) wrapping.add(`${row},${col}`);
  }
  const wraps = (row: number, col: number) => wrapping.has(`${row},${col}`);

  const widths = new Array<number>(model.cols).fill(DEFAULT_COLUMN_WIDTH);
  for (const { row, col, value } of model.cells) {
    const merge = grid.mergeAt(row, col);
    // Spilling text needs no room, and a cell spanning several columns says
    // nothing about any one of them.
    if (!wraps(row, col) || (merge && merge.right > merge.left)) continue;
    const longest = Math.max(...lines(value).map(textWidth));
    widths[col] = Math.min(MAX_COLUMN_WIDTH, Math.max(widths[col] ?? 0, longest));
  }

  const lineCounts = new Array<number>(model.rows).fill(1);
  for (const { row, col, value } of model.cells) {
    if (!wraps(row, col)) continue;
    const merge = grid.mergeAt(row, col);
    const right = merge?.right ?? col;
    const bottom = merge?.bottom ?? row;
    let available = 0;
    for (let c = col; c <= right; c++) available += widths[c] ?? DEFAULT_COLUMN_WIDTH;
    const wrapped = lines(value).reduce(
      (total, line) => total + Math.max(1, Math.ceil(textWidth(line) / available)),
      0,
    );
    // A cell spanning several rows shares its lines between them.
    const perRow = Math.ceil(wrapped / (bottom - row + 1));
    for (let r = row; r <= bottom; r++) lineCounts[r] = Math.max(lineCounts[r] ?? 1, perRow);
  }
  const heights = lineCounts.map((count) =>
    count > 1 ? Math.min(MAX_ROW_HEIGHT_PT, count * LINE_HEIGHT_PT) : undefined,
  );

  return { wraps, vertical: model.merges.length > 0 ? 'middle' : 'bottom', widths, heights };
}

function fillWorksheet(sheet: Worksheet, model: SheetModel, options: ExportOptions): void {
  const layout = planLayout(model);
  layout.widths.forEach((width, col) => (sheet.getColumn(col + 1).width = width));
  layout.heights.forEach((height, row) => {
    if (height !== undefined) sheet.getRow(row + 1).height = height;
  });

  for (const { row, col, value, style } of model.cells) {
    const cell = sheet.getCell(row + 1, col + 1);
    const text = stripControlChars(value);
    cell.value = toXlsxValue(text, options);

    const font = toFont(style);
    if (Object.keys(font).length > 0) cell.font = font;

    const fill = cssToArgb(style.fillColor);
    // White is the default background; filling it would only hide the gridlines.
    if (fill && fill !== WHITE) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }

    const alignment: Partial<Alignment> = {
      wrapText: layout.wraps(row, col),
      vertical: layout.vertical,
    };
    if (style.align) alignment.horizontal = style.align;
    cell.alignment = alignment;
  }

  for (const { top, left, bottom, right } of model.merges) {
    try {
      sheet.mergeCells(top + 1, left + 1, bottom + 1, right + 1);
    } catch (error) {
      // ExcelJS rejects overlapping merges; skip the bad one rather than lose the file.
      console.warn('[google-sheet-copy] skipped merge', { top, left, bottom, right }, error);
    }
  }
}

/** Builds a workbook with one worksheet per SheetModel, in order. */
export async function buildXlsx(sheets: SheetModel[], options: ExportOptions): Promise<Blob> {
  const workbook = new Workbook();
  const taken = new Set<string>();
  for (const model of sheets) {
    fillWorksheet(workbook.addWorksheet(worksheetName(model.sheetName, taken)), model, options);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

/** Builds the workbook and saves it through chrome.downloads. Returns the file name. */
export async function exportXlsx(sheets: SheetModel[], options: ExportOptions): Promise<string> {
  const [first] = sheets;
  // A single sheet is named after its tab; a multi-sheet workbook after the file only.
  const filename = exportFileName(
    first?.title ?? null,
    sheets.length === 1 ? (first?.sheetName ?? null) : null,
    'xlsx',
  );
  await downloadBlob(await buildXlsx(sheets, options), filename);
  return filename;
}
