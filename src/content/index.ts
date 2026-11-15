// Content script — runs on https://docs.google.com/spreadsheets/*

const LOG_PREFIX = '[google-sheet-copy]';
const UI_READY_TIMEOUT_MS = 15_000;

const text = (el: Element | null | undefined): string | null => el?.textContent?.trim() ?? null;

/** Reads an element's value if it is a form control, otherwise its text content. */
const valueOrText = (el: Element | null): string | null => {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return text(el);
};

const tabName = (tab: Element): string =>
  text(tab.querySelector('.docs-sheet-tab-name')) ?? text(tab) ?? '';

/** Diagnostic: logs the Sheets UI elements we rely on, to confirm they are readable. */
function inspectSheetUi(): void {
  const titleInput = document.querySelector('.docs-title-input');
  const tabs = [...document.querySelectorAll('.docs-sheet-tab')];
  const activeTab = document.querySelector('.docs-sheet-tab.docs-sheet-active-tab');
  const formulaBar = document.querySelector('#t-formula-bar-input');
  const nameBox = document.querySelector('#t-name-box');

  const report = {
    fileTitle: valueOrText(titleInput),
    activeTab: activeTab ? tabName(activeTab) : null,
    tabs: tabs.map(tabName),
    formulaBar: text(formulaBar),
    nameBox: valueOrText(nameBox),
  };

  console.group(`${LOG_PREFIX} UI inspection`);
  console.log('File title :', report.fileTitle);
  console.log('Active tab :', report.activeTab);
  console.log('All tabs   :', report.tabs);
  console.log('Formula bar:', report.formulaBar);
  console.log('Name box   :', report.nameBox);

  const missing = Object.entries({
    '.docs-title-input': titleInput,
    '.docs-sheet-tab': tabs[0],
    '.docs-sheet-active-tab': activeTab,
    '#t-formula-bar-input': formulaBar,
    '#t-name-box': nameBox,
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

whenSheetUiReady(inspectSheetUi);
