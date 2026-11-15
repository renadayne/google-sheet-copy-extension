// Content script — runs on https://docs.google.com/spreadsheets/*

import { readFormulaBar, readNameBox, readToolbarState, SELECTORS } from './dom-reader';
import { extractValues } from './extractor';
import { getUsedRange, goToCell, pressCtrlEnd } from './navigator';

const LOG_PREFIX = '[google-sheet-copy]';
const UI_READY_TIMEOUT_MS = 15_000;

const text = (el: Element | null | undefined): string | null => el?.textContent?.trim() ?? null;

const tabName = (tab: Element): string =>
  text(tab.querySelector('.docs-sheet-tab-name')) ?? text(tab) ?? '';

/** Diagnostic: logs the Sheets UI elements we rely on, to confirm they are readable. */
function inspectSheetUi(): void {
  const titleInput = document.querySelector('.docs-title-input');
  const tabs = [...document.querySelectorAll('.docs-sheet-tab')];
  const activeTab = document.querySelector('.docs-sheet-tab.docs-sheet-active-tab');

  console.group(`${LOG_PREFIX} UI inspection`);
  console.log(
    'File title :',
    titleInput instanceof HTMLInputElement ? titleInput.value : text(titleInput),
  );
  console.log('Active tab :', activeTab ? tabName(activeTab) : null);
  console.log('All tabs   :', tabs.map(tabName));
  console.log('Formula bar:', readFormulaBar());
  console.log('Name box   :', readNameBox());
  console.log('Toolbar    :', readToolbarState());

  const missing = Object.entries({
    '.docs-title-input': titleInput,
    '.docs-sheet-tab': tabs[0],
    '.docs-sheet-active-tab': activeTab,
    [SELECTORS.formulaBar]: document.querySelector(SELECTORS.formulaBar),
    [SELECTORS.nameBox]: document.querySelector(SELECTORS.nameBox),
  })
    .filter(([, el]) => !el)
    .map(([selector]) => selector);
  if (missing.length > 0) console.warn('Elements not found:', missing);
  console.groupEnd();
}

/** Sheets renders its UI after document_idle, so wait for the sheet tabs to appear. */
function whenSheetUiReady(callback: () => void): void {
  const isReady = () => document.querySelector('.docs-sheet-tab') !== null;
  if (isReady()) return callback();

  const observer = new MutationObserver(() => {
    if (!isReady()) return;
    finish();
  });
  // On timeout run anyway, so the report shows which elements are missing.
  const timer = setTimeout(finish, UI_READY_TIMEOUT_MS);

  function finish(): void {
    observer.disconnect();
    clearTimeout(timer);
    callback();
  }

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// Debug handle. In DevTools, pick this extension in the console's context dropdown
// (it defaults to "top"), then call e.g. `await gsc.getUsedRange()`.
Object.assign(globalThis, {
  gsc: {
    inspectSheetUi,
    readFormulaBar,
    readNameBox,
    readToolbarState,
    goToCell,
    pressCtrlEnd,
    getUsedRange,
    extractValues,
  },
});

// The popup's button asks for an extraction; the result is printed to this page's console.
chrome.runtime.onMessage.addListener((message: unknown) => {
  if ((message as { type?: unknown } | null)?.type !== 'extract-values') return;
  extractValues().catch((error: unknown) => console.error(LOG_PREFIX, error));
});

whenSheetUiReady(inspectSheetUi);
