// Moves the selection in Google Sheets by simulating keyboard input.

import { getNameBox, readNameBox } from './dom-reader';

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
const POLL_INTERVAL_MS = 5;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `predicate` is true; resolves false if it never is within the timeout. */
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
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

/** Position of the active cell, read from the name box. */
export function currentCell(): CellPosition | null {
  return parseA1(readNameBox() ?? '', 'first');
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
  const target = normalizeRef(a1);
  const moved = await waitFor(
    () => document.activeElement !== nameBox && normalizeRef(nameBox.value) === target,
    GO_TO_TIMEOUT_MS,
  );
  if (!moved) throw new Error(`Could not navigate to ${a1}`);
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

/** Finds the size of the data area, leaving the selection on its last cell. */
export async function measureUsedRange(): Promise<UsedRange> {
  // Start from A1 so the result does not depend on where the selection was.
  await goToCell('A1');
  await pressCtrlEnd();
  const last = parseA1(readNameBox() ?? '', 'last');
  if (!last) throw new Error('Could not read the last cell from the name box');
  return { rows: last.row, cols: last.col };
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
 * Number of rows and columns that hold data, measured from A1 to the cell
 * Ctrl+End lands on. Moves the selection to find out, then restores it.
 */
export function getUsedRange(): Promise<UsedRange> {
  return preservingSelection(measureUsedRange);
}
