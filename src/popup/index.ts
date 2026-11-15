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
import type { SheetModel } from '../shared/model';

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in popup.html`);
  return el as T;
}

const exportButton = element<HTMLButtonElement>('export');
const cancelButton = element<HTMLButtonElement>('cancel');
const formatSelect = element<HTMLSelectElement>('format');
const progressBar = element<HTMLProgressElement>('progress');
const percentLabel = element<HTMLElement>('percent');
const logArea = element<HTMLElement>('log');

let port: chrome.runtime.Port | null = null;

function log(message: string): void {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  logArea.textContent += `[${time}] ${message}\n`;
  logArea.scrollTop = logArea.scrollHeight;
}

function setProgress(percent: number): void {
  progressBar.value = percent;
  percentLabel.textContent = `${percent}%`;
}

function setRunning(running: boolean): void {
  exportButton.disabled = running;
  formatSelect.disabled = running;
  cancelButton.disabled = !running;
}

function finish(): void {
  const closing = port;
  port = null;
  closing?.disconnect();
  setRunning(false);
}

/** Runs the exporter for `format` and describes the outcome for the log. */
async function deliver(model: SheetModel, format: ExportFormat): Promise<string> {
  switch (format) {
    case 'xlsx':
      return `Đã tải xuống: ${await exportXlsx(model)}`;
    case 'csv':
      return `Đã tải xuống: ${await exportCsv(model)}`;
    case 'html':
      await copyHtmlToClipboard(model);
      return 'Đã chép bảng vào clipboard. Mở sheet trống của bạn rồi nhấn Ctrl+V.';
  }
}

async function onContentMessage(message: ContentMessage, format: ExportFormat): Promise<void> {
  switch (message.type) {
    case 'progress': {
      const { done, total } = message;
      setProgress(total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 100);
      return;
    }
    case 'done': {
      const { model } = message;
      setProgress(100);
      log(
        `Quét xong: ${model.rows} hàng x ${model.cols} cột, ` +
          `${model.cells.length} ô có dữ liệu, ${model.merges.length} vùng gộp.`,
      );
      try {
        log(await deliver(model, format));
      } catch (error) {
        log(`Lỗi khi xuất: ${error instanceof Error ? error.message : String(error)}`);
      }
      finish();
      return;
    }
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
  opened.onMessage.addListener((message: ContentMessage) => void onContentMessage(message, format));
  opened.onDisconnect.addListener(() => {
    // Reading lastError marks it as handled. A disconnect we did not initiate means
    // there is no content script in the tab, or the page went away mid-scan.
    void chrome.runtime.lastError;
    if (port !== opened) return;
    port = null;
    log('Không kết nối được với trang. Hãy mở (hoặc tải lại) một Google Sheet rồi thử lại.');
    setRunning(false);
  });

  log(`Bắt đầu quét (định dạng .${format})…`);
  opened.postMessage({ type: 'start' } satisfies PopupMessage);
}

exportButton.addEventListener('click', () => void start());

cancelButton.addEventListener('click', () => {
  if (!port) return;
  cancelButton.disabled = true;
  log('Đang hủy…');
  port.postMessage({ type: 'cancel' } satisfies PopupMessage);
});

setRunning(false);
