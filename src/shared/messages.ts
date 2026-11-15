// Messages exchanged between the popup and the content script over a port.

import type { SheetModel } from './model';

export const EXPORT_PORT = 'sheet-export';

export type ExportFormat = 'xlsx' | 'html' | 'csv';

export type PopupMessage =
  /** `allSheets` scans every tab instead of only the one that is open. */
  | { type: 'start'; allSheets: boolean }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' };

export type ContentMessage =
  /** A tab's scan is starting. `index` is 0-based. */
  | { type: 'sheet'; name: string; index: number; count: number }
  /** Cells processed within the tab last announced by a `sheet` message. */
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; sheets: SheetModel[] }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };
