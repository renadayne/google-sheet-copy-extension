// Helpers shared by the exporters: grid layout, text handling, file names, downloads.

import type { CellValue, MergeRange, SheetModel } from '../shared/model';

const key = (row: number, col: number) => `${row},${col}`;

export interface Grid {
  cellAt(row: number, col: number): CellValue | undefined;
  /** The merge whose top-left corner is this cell, if any. */
  mergeAt(row: number, col: number): MergeRange | undefined;
  /** True for cells hidden inside a merge (every cell of it except the top-left). */
  isCovered(row: number, col: number): boolean;
}

export function toGrid(model: SheetModel): Grid {
  const cells = new Map(model.cells.map((cell) => [key(cell.row, cell.col), cell]));
  const anchors = new Map<string, MergeRange>();
  const covered = new Set<string>();
  for (const merge of model.merges) {
    anchors.set(key(merge.top, merge.left), merge);
    for (let row = merge.top; row <= merge.bottom; row++) {
      for (let col = merge.left; col <= merge.right; col++) {
        if (row !== merge.top || col !== merge.left) covered.add(key(row, col));
      }
    }
  }
  return {
    cellAt: (row, col) => cells.get(key(row, col)),
    mergeAt: (row, col) => anchors.get(key(row, col)),
    isCovered: (row, col) => covered.has(key(row, col)),
  };
}

export interface ExportOptions {
  /**
   * true: cells holding a formula are exported as live formulas.
   * false: the formula's text is exported as plain text, so it is not evaluated.
   */
  formulas: boolean;
}

export const isFormula = (value: string) => value.startsWith('=') && value.length > 1;

/**
 * Removes control characters other than tab and line breaks. XML 1.0 does not
 * allow them, so they would corrupt an xlsx file.
 */
export const stripControlChars = (value: string) =>
  value.replace(/\p{Cc}/gu, (char) => (/[\t\n\r]/.test(char) ? char : ''));

/**
 * Cell text for the text-based formats (HTML, CSV). A leading apostrophe is the
 * spreadsheet convention for "treat this as text", which stops a formula from running.
 */
export function cellText(value: string, { formulas }: ExportOptions): string {
  const text = stripControlChars(value);
  return !formulas && isFormula(text) ? `'${text}` : text;
}

/** File name from the file title and (optionally) a sheet name, safe for Windows and macOS. */
export function exportFileName(
  title: string | null,
  sheetName: string | null,
  extension: string,
): string {
  const base = [title, sheetName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' - ');
  const safe = base
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return `${safe || 'sheet'}.${extension}`;
}

/** Saves a blob through chrome.downloads. Only works in an extension page such as the popup. */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // The download reads the blob asynchronously; give it time before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
