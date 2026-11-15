// Renders a SheetModel as an HTML table with inline styles and puts it on the
// clipboard, so it can be pasted into another spreadsheet with formatting intact.

import type { CellStyle, SheetModel } from '../shared/model';
import { toGrid } from './grid';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Values come from the page, so strip anything that could break out of a style attribute. */
const cssValue = (value: string) => value.replace(/[;"<>{}]/g, '').trim();

function toInlineStyle(style: CellStyle): string {
  const rules: string[] = [];
  if (style.fontFamily) rules.push(`font-family:'${cssValue(style.fontFamily).replace(/'/g, '')}'`);
  const size = Number(style.fontSize);
  if (style.fontSize && Number.isFinite(size) && size > 0) rules.push(`font-size:${size}pt`);
  if (style.bold !== null) rules.push(`font-weight:${style.bold ? 'bold' : 'normal'}`);
  if (style.italic !== null) rules.push(`font-style:${style.italic ? 'italic' : 'normal'}`);
  if (style.underline) rules.push('text-decoration:underline');
  if (style.textColor) rules.push(`color:${cssValue(style.textColor)}`);
  if (style.fillColor) rules.push(`background-color:${cssValue(style.fillColor)}`);
  if (style.align) rules.push(`text-align:${style.align}`);
  return rules.join(';');
}

export function buildHtmlTable(model: SheetModel): string {
  const grid = toGrid(model);
  const rows: string[] = [];
  for (let row = 0; row < model.rows; row++) {
    const cells: string[] = [];
    for (let col = 0; col < model.cols; col++) {
      if (grid.isCovered(row, col)) continue;

      const attributes: string[] = [];
      const merge = grid.mergeAt(row, col);
      if (merge && merge.bottom > merge.top)
        attributes.push(`rowspan="${merge.bottom - merge.top + 1}"`);
      if (merge && merge.right > merge.left)
        attributes.push(`colspan="${merge.right - merge.left + 1}"`);

      const cell = grid.cellAt(row, col);
      const style = cell ? toInlineStyle(cell.style) : '';
      if (style) attributes.push(`style="${escapeHtml(style)}"`);

      const open = ['<td', ...attributes].join(' ');
      // Line breaks inside a cell must stay inside the cell when pasted.
      const content = escapeHtml(cell?.value ?? '').replace(/\r?\n/g, '<br>');
      cells.push(`${open}>${content}</td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table>${rows.join('')}</table>`;
}

/** Tab-separated fallback for paste targets that do not accept HTML. */
export function buildPlainText(model: SheetModel): string {
  const grid = toGrid(model);
  const lines: string[] = [];
  for (let row = 0; row < model.rows; row++) {
    const fields: string[] = [];
    for (let col = 0; col < model.cols; col++) {
      fields.push((grid.cellAt(row, col)?.value ?? '').replace(/[\t\r\n]+/g, ' '));
    }
    lines.push(fields.join('\t'));
  }
  return lines.join('\n');
}

/**
 * Copies the table to the clipboard as text/html (plus a text/plain fallback).
 * Must run in a focused extension page such as the popup.
 */
export async function copyHtmlToClipboard(model: SheetModel): Promise<void> {
  const html = `<meta charset="utf-8">${buildHtmlTable(model)}`;
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([buildPlainText(model)], { type: 'text/plain' }),
    }),
  ]);
}
