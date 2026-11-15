// Popup: starts a scan in the active tab's content script, shows its progress,
// then turns the resulting SheetModel into the chosen format.

import { exportCsv } from '../exporters/csv-exporter';
import { copyHtmlToClipboard } from '../exporters/html-exporter';
import { exportXlsx } from '../exporters/xlsx-exporter';
import {
  type ContentMessage,
  EXPORT_PORT,
  type ExportFormat,
  type PopupMessage,
} from '../shared/messages';
import type { ExportOptions } from '../exporters/grid';
import type { SheetModel } from '../shared/model';

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in popup.html`);
  return el as T;
}

const exportButton = element<HTMLButtonElement>('export');
const pauseButton = element<HTMLButtonElement>('pause');
const cancelButton = element<HTMLButtonElement>('cancel');
const formatSelect = element<HTMLSelectElement>('format');
const formulasBox = element<HTMLInputElement>('formulas');
const allSheetsBox = element<HTMLInputElement>('all-sheets');
const progressBar = element<HTMLProgressElement>('progress');
const percentLabel = element<HTMLElement>('percent');
const logArea = element<HTMLElement>('log');

let port: chrome.runtime.Port | null = null;
/** Position of the tab being scanned, for turning per-tab progress into an overall figure. */
let currentSheet = { index: 0, count: 1 };
let paused = false;

function log(message: string): void {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  logArea.textContent += `[${time}] ${message}\n`;
  logArea.scrollTop = logArea.scrollHeight;
}

function setProgress(percent: number): void {
  progressBar.value = percent;
  percentLabel.textContent = `${percent}%`;
}

function setPaused(value: boolean): void {
  paused = value;
  pauseButton.textContent = paused ? 'Tiếp tục' : 'Tạm dừng';
}

function setRunning(running: boolean): void {
  exportButton.disabled = running;
  formatSelect.disabled = running;
  formulasBox.disabled = running;
  allSheetsBox.disabled = running;
  cancelButton.disabled = !running;
  pauseButton.disabled = !running;
  if (!running) setPaused(false);
}

function finish(): void {
  const closing = port;
  port = null;
  closing?.disconnect();
  setRunning(false);
}

/** Runs the exporter for `format` and describes the outcome for the log. */
async function deliver(
  sheets: SheetModel[],
  format: ExportFormat,
  options: ExportOptions,
): Promise<string> {
  switch (format) {
    case 'xlsx':
      return `Đã tải xuống: ${await exportXlsx(sheets, options)}`;
    case 'csv':
      return `Đã tải xuống: ${(await exportCsv(sheets, options)).join(', ')}`;
    case 'html':
      await copyHtmlToClipboard(sheets, options);
      return 'Đã chép bảng vào clipboard. Mở sheet trống của bạn rồi nhấn Ctrl+V.';
  }
}

async function onContentMessage(
  message: ContentMessage,
  format: ExportFormat,
  options: ExportOptions,
): Promise<void> {
  switch (message.type) {
    case 'sheet': {
      const { name, index, count } = message;
      currentSheet = { index, count };
      log(`Đang quét tab "${name}" (${index + 1}/${count})…`);
      return;
    }
    case 'progress': {
      const { done, total } = message;
      const within = total > 0 ? done / total : 1;
      const overall = (currentSheet.index + within) / currentSheet.count;
      setProgress(Math.min(100, Math.floor(overall * 100)));
      return;
    }
    case 'done': {
      const { sheets } = message;
      setProgress(100);
      for (const model of sheets) {
        log(
          `"${model.sheetName ?? '?'}": ${model.rows} hàng x ${model.cols} cột, ` +
            `${model.cells.length} ô có dữ liệu, ${model.merges.length} vùng gộp.`,
        );
      }
      for (const warning of sheets.flatMap((model) => model.warnings)) log(`Cảnh báo: ${warning}`);
      try {
        log(await deliver(sheets, format, options));
      } catch (error) {
        log(`Lỗi khi xuất: ${error instanceof Error ? error.message : String(error)}`);
      }
      finish();
      return;
    }
    case 'visibility':
      log(
        message.hidden
          ? 'Tab Sheets đang bị ẩn nên việc quét tạm ngừng. Hãy đưa tab đó ra trước.'
          : 'Tab Sheets đã hiển thị lại, tiếp tục quét.',
      );
      return;
    case 'cancelled':
      log('Đã hủy.');
      finish();
      return;
    case 'error':
      log(`Lỗi: ${message.message}`);
      finish();
      return;
  }
}

async function start(): Promise<void> {
  const format = formatSelect.value as ExportFormat;
  const options: ExportOptions = { formulas: formulasBox.checked };
  const allSheets = allSheetsBox.checked;
  currentSheet = { index: 0, count: 1 };
  setRunning(true);
  setProgress(0);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    log('Không tìm thấy tab đang mở.');
    setRunning(false);
    return;
  }

  const opened = chrome.tabs.connect(tab.id, { name: EXPORT_PORT });
  port = opened;
  opened.onMessage.addListener(
    (message: ContentMessage) => void onContentMessage(message, format, options),
  );
  opened.onDisconnect.addListener(() => {
    // Reading lastError marks it as handled. A disconnect we did not initiate means
    // there is no content script in the tab, or the page went away mid-scan.
    void chrome.runtime.lastError;
    if (port !== opened) return;
    port = null;
    log('Không kết nối được với trang. Hãy mở (hoặc tải lại) một Google Sheet rồi thử lại.');
    setRunning(false);
  });

  log(`Bắt đầu quét ${allSheets ? 'tất cả các tab' : 'tab hiện tại'} (định dạng .${format})…`);
  opened.postMessage({ type: 'start', allSheets } satisfies PopupMessage);
}

exportButton.addEventListener('click', () => void start());

pauseButton.addEventListener('click', () => {
  if (!port) return;
  setPaused(!paused);
  log(paused ? 'Đã tạm dừng.' : 'Tiếp tục quét…');
  port.postMessage({ type: paused ? 'pause' : 'resume' } satisfies PopupMessage);
});

cancelButton.addEventListener('click', () => {
  if (!port) return;
  cancelButton.disabled = true;
  pauseButton.disabled = true;
  log('Đang hủy…');
  port.postMessage({ type: 'cancel' } satisfies PopupMessage);
});

setRunning(false);
