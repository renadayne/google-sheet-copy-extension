// Walks the data area of the active sheet and collects every cell's content,
// formatting and merged ranges.

import type { CellValue, MergeRange, SheetModel } from '../shared/model';
import { readActiveSheetName, readFileTitle, readToolbarState } from './dom-reader';
import {
  type CellPosition,
  columnLetters,
  currentCell,
  currentSelection,
  goToCell,
  measureUsedRange,
  preservingSelection,
  pressNavKey,
  readStableText,
  sleep,
  waitFor,
} from './navigator';
import type { PauseGate } from './pause-gate';

/** Cells visited between pauses that hand the main thread back to the page. */
const BATCH_SIZE = 100;
const BATCH_PAUSE_MS = 15;
/** Attempts at reading a cell, or moving to one, before giving up on it. */
const MAX_ATTEMPTS = 3;
const POSITION_TIMEOUT_MS = 300;

export interface ExtractOptions {
  /** Abort to stop the scan; extractValues then rejects with an AbortError. */
  signal?: AbortSignal;
  /** While paused, the scan waits at the next cell. */
  gate?: PauseGate;
  /** Runs after a pause, before the scan re-selects its cell (e.g. to reopen the tab). */
  beforeResume?: () => Promise<void>;
  /** Called as the scan advances, counting cells of the data area (blank ones included). */
  onProgress?: (done: number, total: number) => void;
}

interface Scan {
  cols: number;
  cells: CellValue[];
  /** Merges found so far, keyed by anchor cell, 1-based like the name box. */
  merges: Map<string, MergeRange>;
  warnings: string[];
  options: ExtractOptions;
  /** Cells visited since the scan last yielded to the page. */
  sinceYield: number;
  report: (row: number, col: number) => void;
}

const a1 = (row: number, col: number) => `${columnLetters(col)}${row}`;

/**
 * Called once per visited cell. Stops on abort, waits out a pause, and yields to
 * the page after every batch so Sheets stays responsive during long scans.
 * Resolves true if the scan was paused, in which case the selection may have moved.
 */
async function checkpoint(scan: Scan): Promise<boolean> {
  const { signal, gate, beforeResume } = scan.options;
  signal?.throwIfAborted();
  if (gate?.paused) {
    await gate.wait(signal);
    await beforeResume?.();
    scan.sinceYield = 0;
    return true;
  }
  if (++scan.sinceYield >= BATCH_SIZE) {
    scan.sinceYield = 0;
    await sleep(BATCH_PAUSE_MS);
  }
  return false;
}

/** The active cell, waiting briefly if the name box is momentarily unreadable. */
async function readPosition(): Promise<CellPosition | null> {
  await waitFor(() => currentCell() !== null, POSITION_TIMEOUT_MS);
  return currentCell();
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
 * Moves to (row, col) via the name box, retrying if Sheets does not respond.
 * If the cell is covered by a merge anchored in an earlier row, the name box
 * reports the anchor instead; record the merge and continue just past it.
 * Resolves null when the row has nothing left to visit.
 */
async function enterRow(scan: Scan, row: number, col: number): Promise<CellPosition | null> {
  if (col > scan.cols) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    scan.options.signal?.throwIfAborted();
    try {
      await goToCell(a1(row, col));
    } catch {
      // The name box did not show the cell we asked for; look at where we ended up.
    }
    const here = await readPosition();
    if (here?.row === row && here.col >= col) return here;
    // Covered by a merge from above: its anchor sits in an earlier row, at or left of `col`.
    if (here && here.row < row && here.col <= col) {
      return skipMergeFromAbove(scan, here, row, col);
    }
  }

  scan.warnings.push(
    `Không tới được ô ${a1(row, col)}; bỏ qua phần còn lại của hàng ${row} từ cột ${columnLetters(col)}.`,
  );
  return null;
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
    if (await checkpoint(scan)) {
      // The user may have clicked elsewhere while paused; go back to our cell.
      position = await enterRow(scan, row, position.col);
      if (!position) return;
    }
    scan.report(row, position.col);

    // If the name box shows a range for the active cell, that range is the merge.
    const selection = currentSelection();
    if (selection) {
      const { first, last } = selection;
      if (last.row > first.row || last.col > first.col) {
        noteMerge(scan, first, { bottom: last.row, right: last.col });
      }
    }

    const value = await readStableText();
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
    const next = moved ? await readPosition() : null;

    if (!next || (next.row === row && next.col <= position.col)) {
      // The key press was lost: there is always a column to the right of this one.
      // Fall back to addressing the next cell directly, which cannot overshoot.
      position = await enterRow(scan, row, position.col + 1);
    } else if (next.row !== row) {
      position = await skipMergeFromAbove(scan, next, row, position.col + 1);
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
export function extractValues(options: ExtractOptions = {}): Promise<SheetModel> {
  const { signal, onProgress } = options;
  return preservingSelection(async () => {
    signal?.throwIfAborted();
    const { rows, cols } = await measureUsedRange(signal);
    const total = rows * cols;
    const scan: Scan = {
      cols,
      cells: [],
      merges: new Map(),
      warnings: [],
      options,
      sinceYield: 0,
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

    // Ctrl+End often reports the edge of the grid; trim to the columns actually used.
    const usedCols = Math.max(
      1,
      ...scan.cells.map((cell) => cell.col + 1),
      ...merges.map((merge) => merge.right + 1),
    );

    const model: SheetModel = {
      title: readFileTitle(),
      sheetName: readActiveSheetName(),
      rows,
      cols: usedCols,
      cells: scan.cells,
      merges,
      warnings: scan.warnings,
    };
    console.group(`[google-sheet-copy] SheetModel: ${rows} rows x ${usedCols} cols`);
    console.log(model);
    console.table(model.cells.map(({ row, col, value }) => ({ row, col, value })));
    console.table(model.merges);
    console.groupEnd();
    return model;
  });
}
