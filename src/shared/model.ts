// Data model shared by the content script (which builds it) and the exporters.

export type HorizontalAlign = 'left' | 'center' | 'right';

/** Every field is null when it could not be read from the toolbar. */
export interface CellStyle {
  fontFamily: string | null;
  fontSize: string | null;
  bold: boolean | null;
  italic: boolean | null;
  underline: boolean | null;
  align: HorizontalAlign | null;
  /** CSS colour, as painted on the toolbar button. */
  textColor: string | null;
  fillColor: string | null;
}

/** 0-based position plus the cell's formula-bar text (a formula, if the cell has one). */
export interface CellValue {
  row: number;
  col: number;
  value: string;
  style: CellStyle;
}

/** Merged area, 0-based and inclusive on all sides. */
export interface MergeRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface SheetModel {
  title: string | null;
  sheetName: string | null;
  rows: number;
  cols: number;
  /** Sparse: empty cells are left out. */
  cells: CellValue[];
  merges: MergeRange[];
}
