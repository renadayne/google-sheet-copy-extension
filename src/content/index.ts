// Content script — runs on https://docs.google.com/spreadsheets/*

import { type ContentMessage, EXPORT_PORT, type PopupMessage } from '../shared/messages';
import {
  readActiveSheetName,
  readFileTitle,
  readFormulaBar,
  readNameBox,
  readSheetNames,
  readToolbarState,
  SELECTORS,
} from './dom-reader';
import { extractValues } from './extractor';
import { getUsedRange, goToCell, pressCtrlEnd } from './navigator';
import { extractAllSheets } from './sheet-tabs';

const LOG_PREFIX = '[google-sheet-copy]';
const UI_READY_TIMEOUT_MS = 15_000;

/** Diagnostic: logs the Sheets UI elements we rely on, to confirm they are readable. */
function inspectSheetUi(): void {
  console.group(`${LOG_PREFIX} UI inspection`);
  console.log('File title :', readFileTitle());
  console.log('Active tab :', readActiveSheetName());
  console.log('All tabs   :', readSheetNames());
  console.log('Formula bar:', readFormulaBar());
  console.log('Name box   :', readNameBox());
  console.log('Toolbar    :', readToolbarState());

  const missing = Object.values(SELECTORS).filter((selector) => !document.querySelector(selector));
  if (missing.length > 0) console.warn('Elements not found:', missing);
  console.groupEnd();
}

/** Sheets renders its UI after document_idle, so wait for the sheet tabs to appear. */
function whenSheetUiReady(callback: () => void): void {
  const isReady = () => document.querySelector(SELECTORS.sheetTab) !== null;
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
    extractAllSheets,
  },
});

/** The scan drives the page's single selection, so only one can run at a time. */
let activeScan: AbortController | null = null;

async function runScan(port: chrome.runtime.Port, allSheets: boolean): Promise<void> {
  const post = (message: ContentMessage) => {
    try {
      port.postMessage(message);
    } catch {
      // The popup closed; its onDisconnect handler aborts the scan.
    }
  };

  if (activeScan) {
    post({ type: 'error', message: 'Đang có một lượt quét khác chạy trên trang này.' });
    return;
  }
  const controller = new AbortController();
  activeScan = controller;
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener((message: PopupMessage) => {
    if (message.type === 'cancel') controller.abort();
  });

  let lastPercent = -1;
  const { signal } = controller;
  const onProgress = (done: number, total: number) => {
    // One message per percentage point is plenty for a progress bar.
    const percent = total > 0 ? Math.floor((done / total) * 100) : 100;
    if (percent === lastPercent) return;
    lastPercent = percent;
    post({ type: 'progress', done, total });
  };
  const onSheet = (name: string, index: number, count: number) => {
    lastPercent = -1;
    post({ type: 'sheet', name, index, count });
  };

  try {
    const sheets = allSheets
      ? await extractAllSheets({ signal, onProgress, onSheet })
      : [await extractValues({ signal, onProgress })];
    post({ type: 'done', sheets });
  } catch (error) {
    if (controller.signal.aborted) {
      post({ type: 'cancelled' });
    } else {
      console.error(LOG_PREFIX, error);
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    activeScan = null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== EXPORT_PORT) return;
  const onStart = (message: PopupMessage) => {
    if (message.type !== 'start') return;
    port.onMessage.removeListener(onStart);
    void runScan(port, message.allSheets);
  };
  port.onMessage.addListener(onStart);
});

whenSheetUiReady(inspectSheetUi);
