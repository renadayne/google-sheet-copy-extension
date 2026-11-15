// Read-only access to the Google Sheets UI. Nothing here changes the page.

import type { CellStyle, HorizontalAlign } from '../shared/model';

/** Every field is null when its toolbar element (or the value inside it) cannot be found. */
export type ToolbarState = CellStyle;

export const SELECTORS = {
  formulaBar: '#t-formula-bar-input',
  nameBox: '#t-name-box',
  fileTitle: '.docs-title-input',
  sheetTab: '.docs-sheet-tab',
  activeSheetTab: '.docs-sheet-tab.docs-sheet-active-tab',
} as const;

const sheetTabName = (tab: Element): string =>
  (tab.querySelector('.docs-sheet-tab-name') ?? tab).textContent?.trim() ?? '';

/** Title of the spreadsheet file. */
export function readFileTitle(): string | null {
  const el = document.querySelector(SELECTORS.fileTitle);
  if (el instanceof HTMLInputElement) return el.value;
  return el?.textContent?.trim() ?? null;
}

/** Name of the sheet tab that is currently open. */
export function readActiveSheetName(): string | null {
  const tab = document.querySelector(SELECTORS.activeSheetTab);
  return tab ? sheetTabName(tab) : null;
}

/** Names of all sheet tabs in the bottom bar. */
export function readSheetNames(): string[] {
  return [...document.querySelectorAll(SELECTORS.sheetTab)].map(sheetTabName);
}

// Candidate selectors per control, first match wins. Sheets has renamed these over time.
const TOOLBAR = {
  fontFamily: ['#t-font-family', '#docs-font-family'],
  fontSize: ['#t-font-size', '#docs-font-size', '.docs-font-size-inc-dec-combobox'],
  bold: ['#t-bold'],
  italic: ['#t-italic'],
  underline: ['#t-underline'],
  align: ['#t-align-group', '#t-halign'],
  textColor: ['#t-text-color'],
  fillColor: ['#t-cell-color'],
} as const;

const first = (selectors: readonly string[]): HTMLElement | null => {
  for (const selector of selectors) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
};

const trimmed = (value: string | null | undefined): string | null => {
  const result = value?.trim();
  return result ? result : null;
};

export function getNameBox(): HTMLInputElement | null {
  const el = document.querySelector(SELECTORS.nameBox);
  return el instanceof HTMLInputElement ? el : null;
}

/**
 * Text of an editable region with its line breaks kept. textContent would drop
 * them, because a multi-line value is rendered with <br> or one block per line.
 */
function textWithLineBreaks(root: Node): string {
  let text = '';
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue ?? '';
    } else if (node instanceof HTMLBRElement) {
      text += '\n';
    } else {
      const isBlock =
        node !== root && node instanceof HTMLElement && /^(DIV|P)$/.test(node.tagName);
      if (isBlock && text !== '' && !text.endsWith('\n')) text += '\n';
      node.childNodes.forEach(visit);
    }
  };
  visit(root);
  // Editable regions use non-breaking spaces to keep runs of spaces visible, and
  // end with a placeholder <br>.
  return text.replace(/\u00a0/g, ' ').replace(/\n$/, '');
}

/** Text shown in the formula bar: the formula or raw value of the active cell. */
export function readFormulaBar(): string | null {
  const el = document.querySelector(SELECTORS.formulaBar);
  return el ? textWithLineBreaks(el) : null;
}

/** Text shown in the name box: usually the A1 reference of the current selection. */
export function readNameBox(): string | null {
  return getNameBox()?.value ?? null;
}

/** Label of a dropdown/combobox control such as font family or font size. */
function readCaption(el: HTMLElement | null): string | null {
  if (!el) return null;
  const input = el instanceof HTMLInputElement ? el : el.querySelector('input');
  if (input) return trimmed(input.value);
  return (
    trimmed(el.querySelector('.goog-toolbar-menu-button-caption')?.textContent) ??
    trimmed(el.textContent)
  );
}

function readToggle(el: HTMLElement | null): boolean | null {
  if (!el) return null;
  return (
    el.getAttribute('aria-pressed') === 'true' ||
    el.getAttribute('aria-checked') === 'true' ||
    el.classList.contains('goog-toolbar-button-checked')
  );
}

/** The align button shows an icon for the current alignment; read it from the icon class. */
function readAlign(el: HTMLElement | null): HorizontalAlign | null {
  if (!el) return null;
  for (const node of [el, ...el.querySelectorAll('*')]) {
    const match = /align-(left|center|right)/.exec(node.getAttribute('class') ?? '');
    if (match) return match[1] as HorizontalAlign;
  }
  return null;
}

/** Colour buttons paint the current colour onto an indicator inside the button. */
function readColor(el: HTMLElement | null): string | null {
  if (!el) return null;
  const indicator = el.querySelector<HTMLElement>('.goog-color-menu-button-indicator');
  if (indicator?.style.borderBottomColor) return indicator.style.borderBottomColor;
  for (const node of el.querySelectorAll<HTMLElement>('[style]')) {
    const color = node.style.borderBottomColor || node.style.backgroundColor || node.style.fill;
    if (color) return color;
  }
  return null;
}

/** Formatting of the active cell, as reflected by the toolbar buttons. */
export function readToolbarState(): ToolbarState {
  return {
    fontFamily: readCaption(first(TOOLBAR.fontFamily)),
    fontSize: readCaption(first(TOOLBAR.fontSize)),
    bold: readToggle(first(TOOLBAR.bold)),
    italic: readToggle(first(TOOLBAR.italic)),
    underline: readToggle(first(TOOLBAR.underline)),
    align: readAlign(first(TOOLBAR.align)),
    textColor: readColor(first(TOOLBAR.textColor)),
    fillColor: readColor(first(TOOLBAR.fillColor)),
  };
}
