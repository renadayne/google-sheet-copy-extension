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

function fillWorksheet(sheet: Worksheet, model: SheetModel, options: ExportOptions): void {
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

    const alignment: Partial<Alignment> = {};
    if (style.align) alignment.horizontal = style.align;
    // Without wrapText, Excel shows a multi-line value on a single line.
    if (text.includes('\n')) alignment.wrapText = true;
    if (Object.keys(alignment).length > 0) cell.alignment = alignment;
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
