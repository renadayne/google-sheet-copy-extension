// Messages exchanged between the popup and the content script over a port.

import type { SheetModel } from './model';

export const EXPORT_PORT = 'sheet-export';

export type ExportFormat = 'xlsx' | 'html' | 'csv';

export type PopupMessage = { type: 'start' } | { type: 'cancel' };

export type ContentMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; model: SheetModel }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };
