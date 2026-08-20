import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Box, GridOptions, Page } from '../types.js';

export const DEFAULT_GRID: Required<GridOptions> = {
  cols: 24,
  rows: 36,
  opacity: 0.35,
  snapToWords: true,
};

/** Width of the label margin drawn around the page, in pixels. */
const GUTTER = 30;

export interface Grid {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  pageWidth: number;
  pageHeight: number;
}

export function makeGrid(page: Page, options: GridOptions | undefined): Grid {
  const cols = options?.cols ?? DEFAULT_GRID.cols;
  const rows = options?.rows ?? DEFAULT_GRID.rows;
  return {
    cols,
    rows,
    cellWidth: page.width / cols,
    cellHeight: page.height / rows,
    pageWidth: page.width,
    pageHeight: page.height,
  };
}

/** A, B, ... Z, AA, AB, ... */
export function columnLabel(index: number): string {
  let label = '';
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function parseColumnLabel(label: string): number {
  let value = 0;
  for (const char of label.toUpperCase()) {
    const digit = char.charCodeAt(0) - 64;
    if (digit < 1 || digit > 26) return -1;
    value = value * 26 + digit;
  }
  return value - 1;
}

export interface Cell {
  col: number;
  row: number;
}

/** "C4" or "c4" -> { col: 2, row: 3 }. Returns null on anything else. */
export function parseCell(reference: string): Cell | null {
  const match = /^\s*([A-Za-z]{1,3})\s*(\d{1,3})\s*$/.exec(reference);
  if (!match) return null;
  const col = parseColumnLabel(match[1]!);
  const row = Number.parseInt(match[2]!, 10) - 1;
  if (col < 0 || row < 0) return null;
  return { col, row };
}

/**
 * The rectangle covered by two corner cells, inclusive, clamped to the page.
 * Order does not matter: the caller's two points are treated as a diagonal.
 */
export function cellRangeToBox(grid: Grid, from: Cell, to: Cell): Box {
  const col0 = Math.max(0, Math.min(from.col, to.col));
  const col1 = Math.min(grid.cols - 1, Math.max(from.col, to.col));
  const row0 = Math.max(0, Math.min(from.row, to.row));
  const row1 = Math.min(grid.rows - 1, Math.max(from.row, to.row));

  const x = col0 * grid.cellWidth;
  const y = row0 * grid.cellHeight;
  return {
    x,
    y,
    width: (col1 - col0 + 1) * grid.cellWidth,
    height: (row1 - row0 + 1) * grid.cellHeight,
  };
}

/**
 * Renders the page with a reference grid and labels in an added margin, so the
 * labels never sit on top of the CV content. Returns PNG bytes.
 */
export async function drawGridOverlay(
  page: Page,
  grid: Grid,
  options: GridOptions | undefined,
): Promise<Buffer> {
  const opacity = options?.opacity ?? DEFAULT_GRID.opacity;
  const canvas = createCanvas(page.width + GUTTER * 2, page.height + GUTTER * 2);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const image = await loadImage(page.image);
  ctx.drawImage(image, GUTTER, GUTTER, page.width, page.height);

  // Magenta is a colour no CV uses for body text, so the grid never reads as
  // part of the document.
  ctx.strokeStyle = `rgba(214, 0, 122, ${opacity})`;
  ctx.lineWidth = 1;
  const fontSize = Math.max(11, Math.round(Math.min(grid.cellWidth, grid.cellHeight) * 0.55));
  ctx.font = `600 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  for (let col = 0; col <= grid.cols; col++) {
    const x = GUTTER + col * grid.cellWidth;
    ctx.beginPath();
    ctx.moveTo(x, GUTTER);
    ctx.lineTo(x, GUTTER + page.height);
    ctx.stroke();
    if (col < grid.cols) {
      const label = columnLabel(col);
      const centre = x + grid.cellWidth / 2;
      ctx.fillStyle = '#a8005f';
      ctx.fillText(label, centre, GUTTER / 2);
      ctx.fillText(label, centre, GUTTER + page.height + GUTTER / 2);
    }
  }

  for (let row = 0; row <= grid.rows; row++) {
    const y = GUTTER + row * grid.cellHeight;
    ctx.beginPath();
    ctx.moveTo(GUTTER, y);
    ctx.lineTo(GUTTER + page.width, y);
    ctx.stroke();
    if (row < grid.rows) {
      const label = String(row + 1);
      const centre = y + grid.cellHeight / 2;
      ctx.fillStyle = '#a8005f';
      ctx.fillText(label, GUTTER / 2, centre);
      ctx.fillText(label, GUTTER + page.width + GUTTER / 2, centre);
    }
  }

  return canvas.toBuffer('image/png');
}
