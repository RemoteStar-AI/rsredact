import type { Box, Page, Word } from '../types.js';
import { MissingDependencyError } from '../errors.js';
import { assignLines } from './pdf.js';

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

let workerPromise: Promise<TesseractWorkerLike> | null = null;
let workerLanguage: string | null = null;

interface TesseractWorkerLike {
  recognize(
    image: Buffer,
    options?: unknown,
    output?: unknown,
  ): Promise<{ data: { words?: TesseractWord[]; blocks?: unknown[] } }>;
  terminate(): Promise<unknown>;
}

async function getWorker(language: string): Promise<TesseractWorkerLike> {
  if (workerPromise && workerLanguage === language) return workerPromise;
  await disposeOcr();

  let tesseract: { createWorker: (lang: string) => Promise<TesseractWorkerLike> };
  try {
    tesseract = (await import('tesseract.js')) as never;
  } catch {
    throw new MissingDependencyError('tesseract.js', 'read pages that have no text layer');
  }

  workerLanguage = language;
  workerPromise = tesseract.createWorker(language);
  return workerPromise;
}

/** Frees the tesseract worker. Call this when a long-lived process is done. */
export async function disposeOcr(): Promise<void> {
  const existing = workerPromise;
  workerPromise = null;
  workerLanguage = null;
  if (existing) {
    const worker = await existing.catch(() => null);
    await worker?.terminate().catch(() => undefined);
  }
}

/** Fills in `words` for a page that had no text layer. Mutates the page. */
export async function ocrPage(page: Page, language: string): Promise<void> {
  const worker = await getWorker(language);
  // `blocks: true` is what tesseract.js v5+ needs to return per-word boxes.
  const { data } = await worker.recognize(page.image, {}, { blocks: true, text: false });

  const raw = data.words ?? collectWords(data.blocks ?? []);
  const kept = raw.filter((w) => w.text && w.text.trim().length > 0 && w.confidence > 30);
  const boxes: Box[] = kept.map((w) => ({
    x: w.bbox.x0,
    y: w.bbox.y0,
    width: w.bbox.x1 - w.bbox.x0,
    height: w.bbox.y1 - w.bbox.y0,
  }));
  const lines = assignLines(boxes);

  const words: Word[] = kept.map((w, i) => ({
    id: `p${page.index}o${i}`,
    text: w.text.trim(),
    box: boxes[i]!,
    page: page.index,
    line: lines[i]!,
  }));

  page.words = words.sort((a, b) => a.line - b.line || a.box.x - b.box.x);
  page.textSource = words.length > 0 ? 'ocr' : 'none';
}

/** v6 nests words under blocks > paragraphs > lines > words. */
function collectWords(nodes: unknown[]): TesseractWord[] {
  const out: TesseractWord[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (typeof record.text === 'string' && record.bbox && !record.words && !record.lines) {
      out.push(node as TesseractWord);
      return;
    }
    for (const key of ['blocks', 'paragraphs', 'lines', 'words'] as const) {
      const children = record[key];
      if (Array.isArray(children)) children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return out;
}
