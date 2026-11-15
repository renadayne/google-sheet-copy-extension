// Moves the selection in Google Sheets by simulating keyboard input.

import { getNameBox, readFormulaBar, readNameBox } from './dom-reader';

export interface UsedRange {
  rows: number;
  cols: number;
}

/** 1-based position, as shown in the name box. */
export interface CellPosition {
  row: number;
  col: number;
}

export type NavKey = 'ArrowRight' | 'ArrowLeft' | 'ArrowUp' | 'ArrowDown' | 'End' | 'Home';

const KEY_CODES: Record<NavKey | 'Enter', number> = {
  Enter: 13,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

const GO_TO_TIMEOUT_MS = 2_000;
const MOVE_TIMEOUT_MS = 400;
/** Reads of the formula bar before accepting its text as settled. */
const READ_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `predicate` is true; resolves false if it never is within the timeout. */
export async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return predicate();
}

function dispatchKey(target: EventTarget, key: NavKey | 'Enter', ctrlKey = false): void {
  const keyCode = KEY_CODES[key];
  for (const type of ['keydown', 'keyup'] as const) {
    target.dispatchEvent(
      new KeyboardEvent(type, {
        key,
        code: key,
        // Sheets (Closure) still reads the legacy keyCode/which fields.
        keyCode,
        which: keyCode,
        ctrlKey,
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  }
}

const normalizeRef = (ref: string) => ref.replace(/\$/g, '').trim().toUpperCase();

/** Converts column letters to a 1-based index: A -> 1, Z -> 26, AA -> 27. */
function columnToIndex(letters: string): number {
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return index;
}

/**
 * Parses "B7", "$B$7" or "Sheet1!B7" into a 1-based position.
 * For a range such as "A1:B7", `corner` picks which end to return.
 */
export function parseA1(ref: string, corner: 'first' | 'last' = 'last'): CellPosition | null {
  const parts = (normalizeRef(ref).split('!').pop() ?? '').split(':');
  const cell = (corner === 'first' ? parts[0] : parts[parts.length - 1]) ?? '';
  const match = /^([A-Z]+)(\d+)$/.exec(cell);
  if (!match?.[1] || !match[2]) return null;
  return { row: Number(match[2]), col: columnToIndex(match[1]) };
}

/** Converts a 1-based column index to letters: 1 -> A, 27 -> AA. */
export function columnLetters(index: number): string {
  let letters = '';
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** Position of the active cell, read from the name box. */
export function currentCell(): CellPosition | null {
  return parseA1(readNameBox() ?? '', 'first');
}

/** Both corners of what the name box shows; they are equal for a single cell. */
export function currentSelection(): { first: CellPosition; last: CellPosition } | null {
  const ref = readNameBox() ?? '';
  const first = parseA1(ref, 'first');
  const last = parseA1(ref, 'last');
  return first && last ? { first, last } : null;
}

/** Moves the selection to `a1` by typing it into the name box and pressing Enter. */
export async function goToCell(a1: string): Promise<void> {
  const nameBox = getNameBox();
  if (!nameBox) throw new Error('Name box (#t-name-box) not found');

  nameBox.focus();
  nameBox.select();
  nameBox.value = a1;
  nameBox.dispatchEvent(new Event('input', { bubbles: true }));
  dispatchKey(nameBox, 'Enter');

  // Sheets hands focus back to the grid once it has accepted the reference.
  // A merged cell may be reported as a range ("A1:B2"), so compare its first corner.
  const target = parseA1(a1, 'first');
  const moved = await waitFor(() => {
    if (document.activeElement === nameBox) return false;
    if (normalizeRef(nameBox.value) === normalizeRef(a1)) return true;
    const here = parseA1(nameBox.value, 'first');
    return !!target && here?.row === target.row && here.col === target.col;
  }, GO_TO_TIMEOUT_MS);
  if (!moved) throw new Error(`Could not navigate to ${a1}`);
  // Let Sheets finish updating the formula bar and toolbar for the new cell.
  await sleep(0);
}

/**
 * Presses a navigation key on the grid and waits for the selection to move.
 * Resolves false if the name box did not change, e.g. at the edge of the sheet.
 */
export async function pressNavKey(key: NavKey, { ctrl = false } = {}): Promise<boolean> {
  const before = readNameBox();
  dispatchKey(document.activeElement ?? document.body, key, ctrl);
  const moved = await waitFor(() => readNameBox() !== before, MOVE_TIMEOUT_MS);
  // Let Sheets finish updating the formula bar and toolbar for the new cell.
  if (moved) await sleep(0);
  return moved;
}

/** Presses Ctrl+End, which jumps to the bottom-right cell of the sheet's data. */
export async function pressCtrlEnd(): Promise<void> {
  // No movement is not an error: the selection may already be on the last cell.
  await pressNavKey('End', { ctrl: true });
}

/**
 * Reads the formula bar until two consecutive reads agree, since it can lag a
 * moment behind the name box after the selection moves.
 */
export async function readStableText(): Promise<string> {
  let value = readFormulaBar() ?? '';
  for (let attempt = 1; attempt < READ_ATTEMPTS; attempt++) {
    await sleep(0);
    const again = readFormulaBar() ?? '';
    if (again === value) break;
    value = again;
  }
  return value;
}

/**
 * Last row that holds data in any of the first `cols` columns, probing each column
 * from `bottomRow` with Ctrl+Up. Falls back to `bottomRow` if a probe cannot be
 * trusted, so data is never cut off.
 */
async function findLastDataRow(
  bottomRow: number,
  cols: number,
  signal?: AbortSignal,
): Promise<number> {
  if (bottomRow <= 1) return bottomRow;
  let lastRow = 1;

  for (let col = 1; col <= cols; col++) {
    signal?.throwIfAborted();
    try {
      await goToCell(`${columnLetters(col)}${bottomRow}`);
    } catch {
      // Not reachable, e.g. covered by a merge that another column's probe will find.
      continue;
    }
    // Data in the bottom row itself: nothing to trim.
    if ((await readStableText()) !== '') return bottomRow;

    // From an empty cell, Ctrl+Up lands on the nearest cell with data above it,
    // or on row 1 if the column is empty.
    const moved =
      (await pressNavKey('ArrowUp', { ctrl: true })) ||
      (await pressNavKey('ArrowUp', { ctrl: true }));
    const landed = currentCell();
    if (!moved || !landed) return bottomRow;

    // The landing cell may be the top of a merge; count the whole merge as data.
    const reach = parseA1(readNameBox() ?? '', 'last')?.row ?? landed.row;
    if ((await readStableText()) !== '') lastRow = Math.max(lastRow, reach);
  }
  return lastRow;
}

/**
 * Finds the size of the data area. Ctrl+End gives the bottom-right cell Sheets
 * considers in use, which is often the edge of the grid (e.g. row 1000) even when
 * only a few rows hold data, so the row count is then narrowed column by column.
 */
export async function measureUsedRange(signal?: AbortSignal): Promise<UsedRange> {
  // Start from A1 so the result does not depend on where the selection was.
  await goToCell('A1');
  await pressCtrlEnd();
  const last = parseA1(readNameBox() ?? '', 'last');
  if (!last) throw new Error('Could not read the last cell from the name box');
  return { rows: await findLastDataRow(last.row, last.col, signal), cols: last.col };
}

/** Runs `action`, then puts the selection back where it was. */
export async function preservingSelection<T>(action: () => Promise<T>): Promise<T> {
  const original = readNameBox();
  try {
    return await action();
  } finally {
    if (original) await goToCell(original).catch(() => undefined);
  }
}

/**
 * Number of rows and columns of the data area, starting at A1. Moves the selection to find out, then restores it.
 */
export function getUsedRange(): Promise<UsedRange> {
  return preservingSelection(() => measureUsedRange());
}
