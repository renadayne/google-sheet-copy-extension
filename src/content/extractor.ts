// Walks the data area of the active sheet and collects every cell's content,
// formatting and merged ranges.

import type { CellValue, MergeRange, SheetModel } from '../shared/model';
import { readActiveSheetName, readFileTitle, readToolbarState } from './dom-reader';
import {
  type CellPosition,
  columnLetters,
  currentSelection,
  goToCell,
  measureUsedRange,
  preservingSelection,
  setScanSignal,
  pressNavKey,
  parseA1,
  readCell,
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

/** A place the scan can read: `col` is where its value belongs, `right` its last column. */
interface Stop {
  col: number;
  right: number;
}

/** What the name box shows, waiting briefly if it is momentarily unreadable. */
async function readSelection(): Promise<{ first: CellPosition; last: CellPosition } | null> {
  await waitFor(() => currentSelection() !== null, POSITION_TIMEOUT_MS);
  return currentSelection();
}

/**
 * Works out where the selection landed after a move that aimed at column `col`
 * (or beyond) of `row`: a stop to read, 'end' if the row has nothing left, or 'lost'
 * if the selection is somewhere the move could not have put it.
 *
 * Sheets shows a merged cell in the name box as its full range ("A4:A6"), no
 * matter which of its cells was addressed. So a range here is a merge: record it,
 * and if it starts in an earlier row or column, this row's part of it is covered
 * and holds no value of its own, so continue just past it.
 */
async function settle(scan: Scan, row: number, col: number): Promise<Stop | 'end' | 'lost'> {
  const selection = await readSelection();
  if (!selection) return 'lost';
  const { first, last } = selection;

  if (last.row > first.row || last.col > first.col) {
    scan.merges.set(`${first.row},${first.col}`, {
      top: first.row,
      left: first.col,
      bottom: last.row,
      right: last.col,
    });
    const coversRow = first.row <= row && row <= last.row;
    if (!coversRow || last.col < col) return 'lost';
    if (first.row === row && first.col >= col) return { col: first.col, right: last.col };
    return (await enterRow(scan, row, last.col + 1)) ?? 'end';
  }

  if (first.row !== row || first.col < col) return 'lost';
  return { col: first.col, right: first.col };
}

/**
 * Moves to (row, col) via the name box, retrying if Sheets does not respond.
 * Resolves null when the row has nothing left to visit, or cannot be reached.
 */
async function enterRow(scan: Scan, row: number, col: number): Promise<Stop | null> {
  if (col > scan.cols) return null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    scan.options.signal?.throwIfAborted();
    try {
      await goToCell(a1(row, col));
    } catch {
      continue;
    }
    const landing = await settle(scan, row, col);
    if (landing !== 'lost') return landing === 'end' ? null : landing;
  }

  scan.warnings.push(
    `Không tới được ô ${a1(row, col)}; bỏ qua phần còn lại của hàng ${row} từ cột ${columnLetters(col)}.`,
  );
  return null;
}

/** True if the name box text `ref` is the stop `stop` of `row`. */
function isAt(ref: string, row: number, stop: Stop): boolean {
  const first = parseA1(ref, 'first');
  const last = parseA1(ref, 'last');
  if (!first || !last) return false;
  return first.col === stop.col && last.col === stop.right && first.row <= row && row <= last.row;
}

/** Reads one row left to right, stepping through data and jumping over blanks. */
async function extractRow(scan: Scan, row: number): Promise<void> {
  let stop = await enterRow(scan, row, 1);
  let rereads = 0;

  while (stop && stop.col <= scan.cols) {
    if (await checkpoint(scan)) {
      // The user may have clicked elsewhere while paused; go back to our cell.
      stop = await enterRow(scan, row, stop.col);
      if (!stop) return;
    }
    scan.report(row, stop.right);

    // The text only counts if the selection is still on this stop once it is read.
    // From here to the key press below nothing is awaited, so the press also
    // starts from the cell that was just read.
    const cell = await readCell();
    if (!cell || !isAt(cell.ref, row, stop)) {
      if (++rereads > MAX_ATTEMPTS) {
        scan.warnings.push(
          `Không đọc ổn định được ô ${a1(row, stop.col)}; bỏ qua phần còn lại của hàng ${row}.`,
        );
        return;
      }
      stop = await enterRow(scan, row, stop.col);
      continue;
    }
    rereads = 0;

    const value = cell.text;
    if (value !== '') {
      scan.cells.push({ row: row - 1, col: stop.col - 1, value, style: readToolbarState() });
    }
    if (stop.right >= scan.cols) return;

    // From an empty cell, Ctrl+Right lands on the next cell with data (or the edge
    // of the sheet), so everything it skips is known to be empty.
    const nextCol = stop.right + 1;
    const moved = await pressNavKey('ArrowRight', { ctrl: value === '' });
    // If the key press was lost, or landed somewhere unexpected, address the next
    // cell directly instead: that cannot overshoot.
    const landing = moved ? await settle(scan, row, nextCol) : 'lost';
    if (landing === 'lost') stop = await enterRow(scan, row, nextCol);
    else stop = landing === 'end' ? null : landing;
  }
}

/**
 * Reads every cell from A1 to the cell Ctrl+End lands on, via the formula bar and
 * toolbar. Moves the selection while it runs and restores it afterwards.
 */
export function extractValues(options: ExtractOptions = {}): Promise<SheetModel> {
  const { signal, onProgress } = options;
  setScanSignal(signal);
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
  }).finally(() => setScanSignal(undefined));
}
