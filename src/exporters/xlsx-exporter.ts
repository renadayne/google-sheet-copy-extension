// Writes a SheetModel to an .xlsx workbook with ExcelJS.

import { type Alignment, type CellValue as XlsxValue, type Font, Workbook } from 'exceljs';
import type { CellStyle, SheetModel } from '../shared/model';
import { downloadBlob, exportFileName } from './grid';

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

/** Formula-bar text -> workbook value: formulas stay formulas, plain numbers become numbers. */
function toXlsxValue(text: string): XlsxValue {
  if (text.startsWith('=') && text.length > 1) return { formula: text.slice(1) };
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

/** Sheet names in xlsx are limited to 31 characters and may not contain []:*?/\ */
const worksheetName = (name: string | null) =>
  (name ?? '')
    .replace(/[[\]:*?/\\]/g, '_')
    .replace(/^'+|'+$/g, '')
    .slice(0, 31)
    .trim() || 'Sheet1';

export async function buildXlsx(model: SheetModel): Promise<Blob> {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet(worksheetName(model.sheetName));

  for (const { row, col, value, style } of model.cells) {
    const cell = sheet.getCell(row + 1, col + 1);
    cell.value = toXlsxValue(value);

    const font = toFont(style);
    if (Object.keys(font).length > 0) cell.font = font;

    const fill = cssToArgb(style.fillColor);
    // White is the default background; filling it would only hide the gridlines.
    if (fill && fill !== WHITE) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }

    if (style.align) {
      const alignment: Partial<Alignment> = { horizontal: style.align };
      cell.alignment = alignment;
    }
  }

  for (const { top, left, bottom, right } of model.merges) {
    try {
      sheet.mergeCells(top + 1, left + 1, bottom + 1, right + 1);
    } catch (error) {
      // ExcelJS rejects overlapping merges; skip the bad one rather than lose the file.
      console.warn('[google-sheet-copy] skipped merge', { top, left, bottom, right }, error);
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

/** Builds the workbook and saves it through chrome.downloads. Returns the file name. */
export async function exportXlsx(model: SheetModel): Promise<string> {
  const filename = exportFileName(model, 'xlsx');
  await downloadBlob(await buildXlsx(model), filename);
  return filename;
}
