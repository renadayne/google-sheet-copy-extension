// Walks the data area of the active sheet and collects every cell's content,
// formatting and merged ranges.

import type { CellValue, MergeRange, SheetModel } from '../shared/model';
import { readActiveSheetName, readFileTitle, readFormulaBar, readToolbarState } from './dom-reader';
import {
  type CellPosition,
  columnLetters,
  currentCell,
  currentSelection,
  goToCell,
  measureUsedRange,
  preservingSelection,
  pressNavKey,
} from './navigator';

export interface ExtractOptions {
  /** Abort to stop the scan; extractValues then rejects with an AbortError. */
  signal?: AbortSignal;
  /** Called as the scan advances, counting cells of the data area (blank ones included). */
  onProgress?: (done: number, total: number) => void;
}

interface Scan {
  cols: number;
  cells: CellValue[];
  /** Merges found so far, keyed by anchor cell, 1-based like the name box. */
  merges: Map<string, MergeRange>;
  signal: AbortSignal | undefined;
  report: (row: number, col: number) => void;
}

/** Records that the merge anchored at `anchor` reaches at least `bottom` / `right`. */
function noteMerge(
  scan: Scan,
  anchor: CellPosition,
  extent: { bottom?: number; right?: number },
): MergeRange {
  const key = `${anchor.row},${anchor.col}`;
  const merge = scan.merges.get(key) ?? {
    top: anchor.row,
    left: anchor.col,
    bottom: anchor.row,
    right: anchor.col,
  };
  merge.bottom = Math.max(merge.bottom, extent.bottom ?? 0);
  merge.right = Math.max(merge.right, extent.right ?? 0);
  scan.merges.set(key, merge);
  return merge;
}

/**
 * Moves to (row, col) via the name box. If that cell is covered by a merge anchored
 * in an earlier row, the name box reports the anchor instead; record the merge and
 * retry just past it. Resolves null when the row has nothing left to visit.
 */
async function enterRow(scan: Scan, row: number, col: number): Promise<CellPosition | null> {
  if (col > scan.cols) return null;
  try {
    await goToCell(`${columnLetters(col)}${row}`);
  } catch {
    // The name box did not show the cell we asked for; look at where we ended up.
  }
  const here = currentCell();
  if (!here) return null;
  if (here.row === row) return here;
  return skipMergeFromAbove(scan, here, row, col);
}

/** The selection landed on `anchor`, a merge from an earlier row that covers (row, col). */
async function skipMergeFromAbove(
  scan: Scan,
  anchor: CellPosition,
  row: number,
  col: number,
): Promise<CellPosition | null> {
  if (anchor.row > row) return null;
  const merge = noteMerge(scan, anchor, { bottom: row, right: col });
  return enterRow(scan, row, Math.max(merge.right, col) + 1);
}

/** Reads one row left to right, stepping through data and jumping over blanks. */
async function extractRow(scan: Scan, row: number): Promise<void> {
  let position = await enterRow(scan, row, 1);

  while (position && position.col <= scan.cols) {
    scan.signal?.throwIfAborted();
    scan.report(row, position.col);

    // If the name box shows a range for the active cell, that range is the merge.
    const selection = currentSelection();
    if (selection) {
      const { first, last } = selection;
      if (last.row > first.row || last.col > first.col) {
        noteMerge(scan, first, { bottom: last.row, right: last.col });
      }
    }

    const value = readFormulaBar() ?? '';
    if (value !== '') {
      scan.cells.push({
        row: row - 1,
        col: position.col - 1,
        value,
        style: readToolbarState(),
      });
    }
    if (position.col >= scan.cols) return;

    // From an empty cell, Ctrl+Right lands on the next cell with data (or the edge
    // of the sheet), so everything it skips is known to be empty.
    const stepped = value !== '';
    const moved = await pressNavKey('ArrowRight', { ctrl: !stepped });
    const next = currentCell();
    if (!moved || !next) return;

    if (next.row !== row) {
      position = await skipMergeFromAbove(scan, next, row, position.col + 1);
    } else if (next.col <= position.col) {
      return;
    } else {
      // A single step that skips columns means the cell we left spans them.
      if (stepped && next.col > position.col + 1) {
        noteMerge(scan, position, { right: next.col - 1 });
      }
      position = next;
    }
  }
}

/**
 * Reads every cell from A1 to the cell Ctrl+End lands on, via the formula bar and
 * toolbar. Moves the selection while it runs and restores it afterwards.
 */
export function extractValues({ signal, onProgress }: ExtractOptions = {}): Promise<SheetModel> {
  return preservingSelection(async () => {
    signal?.throwIfAborted();
    const { rows, cols } = await measureUsedRange();
    const total = rows * cols;
    const scan: Scan = {
      cols,
      cells: [],
      merges: new Map(),
      signal,
      report: (row, col) => onProgress?.((row - 1) * cols + Math.min(col, cols), total),
    };

    for (let row = 1; row <= rows; row++) {
      signal?.throwIfAborted();
      await extractRow(scan, row);
      onProgress?.(row * cols, total);
    }

    const merges = [...scan.merges.values()]
      .filter((merge) => merge.bottom > merge.top || merge.right > merge.left)
      .map(({ top, left, bottom, right }) => ({
        top: top - 1,
        left: left - 1,
        bottom: Math.min(bottom, rows) - 1,
        right: Math.min(right, cols) - 1,
      }));

    const model: SheetModel = {
      title: readFileTitle(),
      sheetName: readActiveSheetName(),
      rows,
      cols,
      cells: scan.cells,
      merges,
    };
    console.group(`[google-sheet-copy] SheetModel: ${rows} rows x ${cols} cols`);
    console.log(model);
    console.table(model.cells.map(({ row, col, value }) => ({ row, col, value })));
    console.table(model.merges);
    console.groupEnd();
    return model;
  });
}
