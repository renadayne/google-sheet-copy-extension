// Writes a SheetModel to CSV: values only, no formatting or merges.

import type { SheetModel } from '../shared/model';
import { downloadBlob, exportFileName, toGrid } from './grid';

const escapeField = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function buildCsv(model: SheetModel): string {
  const grid = toGrid(model);
  const lines: string[] = [];
  for (let row = 0; row < model.rows; row++) {
    const fields: string[] = [];
    for (let col = 0; col < model.cols; col++) {
      fields.push(escapeField(grid.cellAt(row, col)?.value ?? ''));
    }
    lines.push(fields.join(','));
  }
  return lines.join('\r\n');
}

/** Builds the CSV and saves it through chrome.downloads. Returns the file name. */
export async function exportCsv(model: SheetModel): Promise<string> {
  const filename = exportFileName(model, 'csv');
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob(['﻿', buildCsv(model)], { type: 'text/csv;charset=utf-8' });
  await downloadBlob(blob, filename);
  return filename;
}
