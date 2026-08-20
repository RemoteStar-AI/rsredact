import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';

/**
 * pdf.js reports the total width of a text run but not where each character
 * inside it sits, and a run is often a whole line. Splitting that width evenly
 * across characters drifts badly: in most fonts an "i" is a third the width of
 * an "m", so by the middle of a line the computed position can be a full
 * character off. In a redaction tool that means the first letter of an email
 * address stays visible.
 *
 * Measuring each character against a proxy font of the same broad class and
 * then scaling the result so it sums to the run's real width keeps the relative
 * spacing honest. It is still an approximation, but the error is a fraction of
 * a character rather than a whole one.
 */

let measurer: SKRSContext2D | null = null;

function context(): SKRSContext2D {
  if (!measurer) measurer = createCanvas(8, 8).getContext('2d');
  return measurer;
}

/** Maps an embedded PDF font name onto a font class the measurer has. */
export function proxyFamily(fontName: string | undefined): string {
  const name = (fontName ?? '').toLowerCase();
  if (/mono|courier|consol/.test(name)) return 'monospace';
  if (/times|serif|georgia|garamond|book|minion|cambria/.test(name)) return 'serif';
  return 'sans-serif';
}

const cache = new Map<string, number[]>();

/**
 * Per-character advance widths for `text`, scaled to sum to `totalWidth`.
 * Whitespace is included so callers can index by character position.
 */
export function apportion(
  text: string,
  totalWidth: number,
  fontHeight: number,
  fontName?: string,
): number[] {
  if (text.length === 0) return [];

  const family = proxyFamily(fontName);
  const key = `${family} ${text}`;
  let relative = cache.get(key);

  if (!relative) {
    const ctx = context();
    // Measured at a fixed size and scaled later, so the cache is size-independent.
    ctx.font = `100px ${family}`;
    relative = [...text].map((char) => ctx.measureText(char).width);
    if (cache.size > 4096) cache.clear();
    cache.set(key, relative);
  }

  const sum = relative.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    return new Array<number>(text.length).fill(totalWidth / text.length);
  }
  const scale = totalWidth / sum;
  return relative.map((width) => width * scale);
}
