// Walks the data area of the active sheet and collects every cell's content.

import { readFormulaBar, readToolbarState, type ToolbarState } from './dom-reader';
import {
  currentCell,
  goToCell,
  measureUsedRange,
  preservingSelection,
  pressNavKey,
} from './navigator';

/** 0-based position plus the cell's formula-bar text (a formula, if the cell has one). */
export interface CellValue {
  row: number;
  col: number;
  value: string;
  /** Formatting shown by the toolbar while the cell was selected. */
  style: ToolbarState;
}

/** `cells` is sparse: empty cells are left out. */
export interface SheetModel {
  rows: number;
  cols: number;
  cells: CellValue[];
}

/** Reads one row left to right, stepping through data and jumping over blanks. */
async function extractRow(row: number, cols: number, cells: CellValue[]): Promise<void> {
  try {
    await goToCell(`A${row}`);
  } catch {
    // The name box did not land on A<row>; a merged cell from an earlier row covers it.
  }
  let position = currentCell();
  if (position?.row !== row) return;

  while (position.col <= cols) {
    const value = readFormulaBar() ?? '';
    if (value !== '') {
      cells.push({ row: row - 1, col: position.col - 1, value, style: readToolbarState() });
    }
    if (position.col === cols) return;

    // From an empty cell, Ctrl+Right lands on the next cell with data (or the edge
    // of the sheet), so everything it skips is known to be empty.
    const moved = await pressNavKey('ArrowRight', { ctrl: value === '' });
    const next = currentCell();
    if (!moved || next?.row !== row || next.col <= position.col) return;
    position = next;
  }
}

/**
 * Reads every cell from A1 to the cell Ctrl+End lands on, via the formula bar.
 * Moves the selection while it runs and restores it afterwards.
 */
export function extractValues(): Promise<SheetModel> {
  return preservingSelection(async () => {
    const { rows, cols } = await measureUsedRange();
    const cells: CellValue[] = [];
    for (let row = 1; row <= rows; row++) await extractRow(row, cols, cells);

    const model: SheetModel = { rows, cols, cells };
    console.group(`[google-sheet-copy] SheetModel: ${rows} rows x ${cols} cols`);
    console.log(model);
    console.table(cells);
    console.groupEnd();
    return model;
  });
}
