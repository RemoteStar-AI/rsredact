import type { Box, Page, Word } from '../types.js';

export interface LineText {
  /** 1-based, as shown to the LLM. */
  number: number;
  text: string;
  words: Word[];
  /** Start offset of each word inside `text`. */
  offsets: number[];
}

/**
 * Rebuilds readable lines from positioned words. The offsets let a character
 * range in the reconstructed string be mapped back to the words that produced
 * it, which is how both regex matches and LLM quotes turn into boxes.
 */
export function buildLines(page: Page): LineText[] {
  const grouped = new Map<number, Word[]>();
  for (const word of page.words) {
    const bucket = grouped.get(word.line);
    if (bucket) bucket.push(word);
    else grouped.set(word.line, [word]);
  }

  const lines: LineText[] = [];
  const orderedKeys = [...grouped.keys()].sort((a, b) => a - b);

  for (const key of orderedKeys) {
    const words = grouped.get(key)!.sort((a, b) => a.box.x - b.box.x);
    let text = '';
    const offsets: number[] = [];
    for (let i = 0; i < words.length; i++) {
      if (i > 0) text += ' ';
      offsets.push(text.length);
      text += words[i]!.text;
    }
    if (!text.trim()) continue;
    lines.push({ number: lines.length + 1, text, words, offsets });
  }
  return lines;
}

/** Words whose reconstructed span overlaps [start, end). */
export function wordsInRange(line: LineText, start: number, end: number): Word[] {
  const out: Word[] = [];
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i]!;
    const wordStart = line.offsets[i]!;
    const wordEnd = wordStart + word.text.length;
    if (wordStart < end && wordEnd > start) out.push(word);
  }
  return out;
}

export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}
