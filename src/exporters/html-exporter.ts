// Renders SheetModels as an HTML table with inline styles and puts it on the
// clipboard, so it can be pasted into another spreadsheet with formatting intact.

import type { CellStyle, SheetModel } from '../shared/model';
import { cellText, type ExportOptions, toGrid } from './grid';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Values come from the page, so strip anything that could break out of a style attribute. */
const cssValue = (value: string) => value.replace(/[;"<>{}]/g, '').trim();

function toInlineStyle(style: CellStyle | undefined, text: string): string {
  const rules: string[] = [];
  if (style?.fontFamily) {
    rules.push(`font-family:'${cssValue(style.fontFamily).replace(/'/g, '')}'`);
  }
  const size = Number(style?.fontSize);
  if (style?.fontSize && Number.isFinite(size) && size > 0) rules.push(`font-size:${size}pt`);
  if (style && style.bold !== null) rules.push(`font-weight:${style.bold ? 'bold' : 'normal'}`);
  if (style && style.italic !== null) {
    rules.push(`font-style:${style.italic ? 'italic' : 'normal'}`);
  }
  if (style?.underline) rules.push('text-decoration:underline');
  if (style?.textColor) rules.push(`color:${cssValue(style.textColor)}`);
  if (style?.fillColor) rules.push(`background-color:${cssValue(style.fillColor)}`);
  if (style?.align) rules.push(`text-align:${style.align}`);
  // HTML collapses runs of whitespace; keep leading, trailing and repeated spaces.
  if (/^\s|\s$|\s{2}/.test(text)) rules.push('white-space:pre-wrap');
  return rules.join(';');
}

function buildRows(model: SheetModel, options: ExportOptions): string[] {
  const grid = toGrid(model);
  const rows: string[] = [];
  for (let row = 0; row < model.rows; row++) {
    const cells: string[] = [];
    for (let col = 0; col < model.cols; col++) {
      if (grid.isCovered(row, col)) continue;

      const attributes: string[] = [];
      const merge = grid.mergeAt(row, col);
      if (merge && merge.bottom > merge.top) {
        attributes.push(`rowspan="${merge.bottom - merge.top + 1}"`);
      }
      if (merge && merge.right > merge.left) {
        attributes.push(`colspan="${merge.right - merge.left + 1}"`);
      }

      const cell = grid.cellAt(row, col);
      const text = cellText(cell?.value ?? '', options);
      const style = toInlineStyle(cell?.style, text);
      if (style) attributes.push(`style="${escapeHtml(style)}"`);

      const open = ['<td', ...attributes].join(' ');
      // Line breaks inside a cell must stay inside the cell when pasted.
      cells.push(`${open}>${escapeHtml(text).replace(/\r?\n/g, '<br>')}</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return rows;
}

/**
 * One table for everything. The clipboard pastes into a single sheet, so several
 * sheets are stacked, each under a bold row with its name and followed by a blank row.
 */
export function buildHtmlTable(sheets: SheetModel[], options: ExportOptions): string {
  const rows = sheets.flatMap((model) => {
    const body = buildRows(model, options);
    if (sheets.length === 1) return body;
    const heading = `<tr><td style="font-weight:bold">${escapeHtml(model.sheetName ?? '')}</td></tr>`;
    return [heading, ...body, '<tr><td></td></tr>'];
  });
  return `<table>${rows.join('')}</table>`;
}

/** Tab-separated fallback for paste targets that do not accept HTML. */
export function buildPlainText(sheets: SheetModel[], options: ExportOptions): string {
  const lines = sheets.flatMap((model) => {
    const grid = toGrid(model);
    const body: string[] = [];
    for (let row = 0; row < model.rows; row++) {
      const fields: string[] = [];
      for (let col = 0; col < model.cols; col++) {
        // A tab or line break would shift the remaining cells, so flatten them.
        const text = cellText(grid.cellAt(row, col)?.value ?? '', options);
        fields.push(text.replace(/[\t\r\n]+/g, ' '));
      }
      body.push(fields.join('\t'));
    }
    return sheets.length === 1 ? body : [model.sheetName ?? '', ...body, ''];
  });
  return lines.join('\n');
}

/**
 * Copies the table to the clipboard as text/html (plus a text/plain fallback).
 * Must run in a focused extension page such as the popup.
 */
export async function copyHtmlToClipboard(
  sheets: SheetModel[],
  options: ExportOptions,
): Promise<void> {
  const html = `<meta charset="utf-8">${buildHtmlTable(sheets, options)}`;
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([buildPlainText(sheets, options)], { type: 'text/plain' }),
    }),
  ]);
}
