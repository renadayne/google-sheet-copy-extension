// Switches between the sheet tabs in the bottom bar and scans each of them.

import type { SheetModel } from '../shared/model';
import { readNameBox, SELECTORS } from './dom-reader';
import { type ExtractOptions, extractValues } from './extractor';
import { sleep, waitFor } from './navigator';
import type { PauseGate } from './pause-gate';

const TAB_SWITCH_TIMEOUT_MS = 5_000;
const TAB_SETTLE_MS = 300;
const ACTIVE_TAB_CLASS = 'docs-sheet-active-tab';

export interface ExtractAllOptions {
  signal?: AbortSignal;
  gate?: PauseGate;
  /** Called when the scan of a tab starts. `index` is 0-based. */
  onSheet?: (name: string, index: number, count: number) => void;
  /** Progress within the tab that `onSheet` last announced. */
  onProgress?: ExtractOptions['onProgress'];
}

const tabName = (tab: Element): string =>
  (tab.querySelector('.docs-sheet-tab-name') ?? tab).textContent?.trim() ?? '';

const isActive = (tab: Element) => tab.classList.contains(ACTIVE_TAB_CLASS);

/** Tabs shown in the bottom bar. Hidden sheets have no visible tab and are left out. */
export function listSheetTabs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(SELECTORS.sheetTab)].filter(
    (tab) => getComputedStyle(tab).display !== 'none',
  );
}

/** Clicks a sheet tab and waits for Sheets to switch to it. */
export async function activateSheetTab(tab: HTMLElement): Promise<void> {
  if (!isActive(tab)) {
    for (const type of ['mousedown', 'mouseup', 'click'] as const) {
      tab.dispatchEvent(
        new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0 }),
      );
    }
    const switched = await waitFor(() => isActive(tab), TAB_SWITCH_TIMEOUT_MS);
    if (!switched) throw new Error(`Could not switch to tab "${tabName(tab)}"`);
  }
  // Wait for the new sheet's grid: the name box is filled in once a cell is active.
  await waitFor(() => !!readNameBox(), TAB_SWITCH_TIMEOUT_MS);
  await sleep(TAB_SETTLE_MS);
}

/** Scans every visible tab in order, then returns to the tab that was open. */
export async function extractAllSheets({
  signal,
  gate,
  onSheet,
  onProgress,
}: ExtractAllOptions = {}): Promise<SheetModel[]> {
  const tabs = listSheetTabs();
  if (tabs.length === 0) throw new Error('No sheet tabs found');
  const original = tabs.find(isActive);

  const sheets: SheetModel[] = [];
  try {
    for (const [index, tab] of tabs.entries()) {
      signal?.throwIfAborted();
      onSheet?.(tabName(tab), index, tabs.length);
      await activateSheetTab(tab);
      // After a pause the user may be looking at another tab; reopen this one first.
      const beforeResume = () => activateSheetTab(tab);
      sheets.push(await extractValues({ signal, gate, beforeResume, onProgress }));
    }
  } finally {
    if (original?.isConnected) await activateSheetTab(original).catch(() => undefined);
  }
  return sheets;
}
