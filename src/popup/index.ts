// Popup entry point. For now it only triggers the extraction diagnostic.

const button = document.querySelector<HTMLButtonElement>('#extract');
const statusLine = document.querySelector<HTMLElement>('#status');

button?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'extract-values' });
    if (statusLine) statusLine.textContent = 'Running. See the page console.';
  } catch {
    // No content script in this tab: not a Google Sheet, or the tab predates the extension.
    if (statusLine) statusLine.textContent = 'Open (or reload) a Google Sheet first.';
  }
});
