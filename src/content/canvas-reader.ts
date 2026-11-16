// Reads a cell's background colour from the pixels Sheets paints on its grid canvas.
//
// The toolbar's fill-colour button is an unreliable source: it is hidden in
// view-only mode, and its colour bar does not always follow the active cell. The
// canvas, on the other hand, always shows what the user sees. The selection border
// is a DOM overlay drawn above the canvas, so it does not cover the pixels read here.

/** Elements Sheets draws around the active cell (or the whole merge it belongs to). */
const ACTIVE_CELL_BORDER = '.active-cell-border';

/** Distance from the cell's edges, in CSS pixels, to stay clear of gridlines. */
const INSET = 3;

/** Bounding box of the active cell on screen, from its selection border. */
export function activeCellRect(): DOMRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of document.querySelectorAll<HTMLElement>(ACTIVE_CELL_BORDER)) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!(right > left && bottom > top)) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

/** The pixel of whatever canvas is painted at viewport point (x, y), as [r, g, b]. */
function pixelAt(x: number, y: number): [number, number, number] | null {
  const canvas = document
    .elementsFromPoint(x, y)
    .find((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  // The backing store is usually larger than the CSS box (devicePixelRatio).
  const px = Math.floor(((x - rect.left) * canvas.width) / rect.width);
  const py = Math.floor(((y - rect.top) * canvas.height) / rect.height);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;

  try {
    const context = canvas.getContext('2d');
    const data = context?.getImageData(px, py, 1, 1).data;
    if (!data || data[3] === 0) return null; // transparent: nothing painted here
    return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
  } catch {
    // A tainted canvas or one with a non-2D context cannot be read.
    return null;
  }
}

/**
 * Background colour of the active cell. Resolves `{ fill: "rgb(r, g, b)" }`, or
 * `{ fill: null }` for the default white, or null if it cannot be read (cell off
 * screen, canvas missing), in which case the caller may fall back on the toolbar.
 *
 * Several points along the top of the cell are sampled and the most frequent
 * colour wins. Text sits at the bottom by default and starts a few pixels in, so
 * the top strip is nearly always bare background; the vote outweighs the odd
 * glyph that reaches it.
 */
export function readCanvasFillColor(): { fill: string | null } | null {
  const cell = activeCellRect();
  if (!cell || cell.width <= 2 * INSET || cell.height <= 2 * INSET) return null;

  // Half of the cell must be on screen; otherwise points could fall on headers.
  const visibleX = Math.min(cell.right, window.innerWidth) - Math.max(cell.left, 0);
  const visibleY = Math.min(cell.bottom, window.innerHeight) - Math.max(cell.top, 0);
  if (visibleX < cell.width / 2 || visibleY < cell.height / 2) return null;

  const y = cell.top + INSET;
  const xs = [0, 0.25, 0.5, 0.75, 1].map(
    (t) => cell.left + INSET + t * (cell.width - 2 * INSET - 1),
  );

  const votes = new Map<string, number>();
  for (const x of xs) {
    const pixel = pixelAt(x, y);
    if (!pixel) continue;
    const key = pixel.join(',');
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }

  let winner: string | null = null;
  let best = 0;
  for (const [key, count] of votes) {
    if (count > best) [winner, best] = [key, count];
  }
  // Too little agreement means the strip is mostly text or the canvas is mid-redraw.
  if (!winner || best < 2) return null;
  if (winner === '255,255,255') return { fill: null };
  return { fill: `rgb(${winner.replace(/,/g, ', ')})` };
}
