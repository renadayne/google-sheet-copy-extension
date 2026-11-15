// Writes SheetModels to CSV: values only, no formatting or merges.

import type { SheetModel } from '../shared/model';
import { cellText, downloadBlob, exportFileName, type ExportOptions, toGrid } from './grid';

/** RFC 4180: quote fields containing a quote, comma or line break; double the quotes. */
const escapeField = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function buildCsv(model: SheetModel, options: ExportOptions): string {
  const grid = toGrid(model);
  const lines: string[] = [];
  for (let row = 0; row < model.rows; row++) {
    const fields: string[] = [];
    for (let col = 0; col < model.cols; col++) {
      fields.push(escapeField(cellText(grid.cellAt(row, col)?.value ?? '', options)));
    }
    lines.push(fields.join(','));
  }
  return lines.join('\r\n');
}

/**
 * Saves one CSV file per sheet through chrome.downloads (CSV cannot hold several
 * sheets). Returns the file names.
 */
export async function exportCsv(sheets: SheetModel[], options: ExportOptions): Promise<string[]> {
  const filenames: string[] = [];
  for (const model of sheets) {
    const filename = exportFileName(model.title, model.sheetName, 'csv');
    // The BOM makes Excel read the file as UTF-8.
    const blob = new Blob(['﻿', buildCsv(model, options)], {
      type: 'text/csv;charset=utf-8',
    });
    await downloadBlob(blob, filename);
    filenames.push(filename);
  }
  return filenames;
}
