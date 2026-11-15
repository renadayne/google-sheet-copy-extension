// Helpers shared by the exporters for laying a sparse SheetModel out as a grid.

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

/** File name built from the spreadsheet title and sheet name, safe for Windows and macOS. */
export function exportFileName(model: SheetModel, extension: string): string {
  const base = [model.title, model.sheetName]
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
