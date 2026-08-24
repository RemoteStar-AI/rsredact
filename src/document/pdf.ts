import {
  GlobalWorkerOptions,
  getDocument,
  Util,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js';
import type { Box, Page, PageLink, Word } from '../types.js';
import { createRequire } from 'node:module';
import { NapiCanvasFactory } from './canvas-factory.js';
import { apportion } from './advance-widths.js';

const PDF_POINTS_PER_INCH = 72;

/**
 * pdf.js resolves the standard 14 fonts and CID character maps from these
 * directories. In a browser they are URLs; under Node they are filesystem
 * paths, and they must end in a separator. Without them a PDF that relies on a
 * standard font or a CID-keyed font renders as empty boxes.
 */
const require_ = createRequire(import.meta.url);
const PDFJS_ROOT = require_.resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
const STANDARD_FONTS = `${PDFJS_ROOT}standard_fonts/`;
const CMAPS = `${PDFJS_ROOT}cmaps/`;

/**
 * Under Node, pdf.js runs the worker in-process and reaches it with a dynamic
 * `import()` of a path it works out for itself. That path is invisible to a
 * bundler or a file tracer, so in a serverless build the worker is left out of
 * the deployment and the first `getDocument` fails with "Setting up fake worker
 * failed". Resolving it here with `require.resolve` and a literal specifier
 * makes the dependency statically analysable, so the file gets traced and
 * shipped like any other.
 */
GlobalWorkerOptions.workerSrc = require_.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

export interface RenderedPdf {
  pages: Page[];
  pointSizes: { width: number; height: number }[];
}

/**
 * Rasterising is where the memory goes, so the size of the job is settled before
 * the first page is painted. A few hundred bytes of PDF can declare a 10000pt
 * square page, which is 20833px a side at 150 dpi and gigabytes of canvas. Page
 * count and total pixels are both knowable from the viewports up front, so refuse
 * there rather than after the damage is done.
 */
export const MAX_PAGE_PIXELS = 40_000_000;
export const MAX_DOCUMENT_PIXELS = 200_000_000;

function tooBig(message: string): Error {
  return Object.assign(new Error(message), { code: 'UNSUPPORTED_INPUT' });
}

export async function loadPdf(
  data: Buffer,
  dpi: number,
  limits: { maxPages?: number } = {},
): Promise<RenderedPdf> {
  const scale = dpi / PDF_POINTS_PER_INCH;
  const doc = await getDocument({
    // pdf.js mutates the buffer it is given, so hand it a copy.
    data: new Uint8Array(data),
    CanvasFactory: NapiCanvasFactory,
    // A CV is a document, not an application: no scripts, no external fetches.
    isEvalSupported: false,
    // There is no DOM here, so @font-face registration cannot work. This makes
    // pdf.js paint glyph outlines directly onto the canvas instead, which is
    // the difference between a readable page and a page of empty boxes.
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
  }).promise;

  if (limits.maxPages && doc.numPages > limits.maxPages) {
    throw tooBig(`That document has ${doc.numPages} pages, and the limit is ${limits.maxPages}.`);
  }

  let planned = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const viewport = (await doc.getPage(i)).getViewport({ scale });
    const pixels = viewport.width * viewport.height;
    if (pixels > MAX_PAGE_PIXELS) {
      throw tooBig(
        `Page ${i} would rasterise to ${Math.round(pixels / 1e6)} megapixels at ${dpi} dpi, over ` +
          `the ${Math.round(MAX_PAGE_PIXELS / 1e6)} megapixel limit for a single page.`,
      );
    }
    planned += pixels;
  }
  if (planned > MAX_DOCUMENT_PIXELS) {
    throw tooBig(
      `This document would rasterise to ${Math.round(planned / 1e6)} megapixels at ${dpi} dpi, ` +
        `over the ${Math.round(MAX_DOCUMENT_PIXELS / 1e6)} megapixel limit.`,
    );
  }

  const factory = new NapiCanvasFactory();
  const pages: Page[] = [];
  const pointSizes: { width: number; height: number }[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const unscaled = page.getViewport({ scale: 1 });
      pointSizes.push({ width: unscaled.width, height: unscaled.height });

      const target = factory.create(viewport.width, viewport.height);
      // pdf.js paints only the content, so start from white paper.
      target.context.fillStyle = '#ffffff';
      target.context.fillRect(0, 0, viewport.width, viewport.height);

      await page.render({ canvasContext: target.context as never, viewport }).promise;
      const image = target.canvas.toBuffer('image/png');
      const words = await extractWords(page, viewport.transform, i - 1);
      const links = await extractLinks(page, viewport.transform);
      factory.destroy(target);

      pages.push({
        index: i - 1,
        width: Math.ceil(viewport.width),
        height: Math.ceil(viewport.height),
        image,
        words,
        textSource: words.length > 0 ? 'pdf-text-layer' : 'none',
        links,
      });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return { pages, pointSizes };
}

/**
 * PDFs keep hyperlinks in an annotation layer beside the text, not in it. Text
 * extraction alone therefore misses the URL behind anchor text like
 * "Portfolio" or "LinkedIn", which is exactly the kind of identifier this tool
 * exists to remove. The annotation rects are in the same coordinate space as
 * the text, so they need no separate localisation.
 */
async function extractLinks(page: PDFPageProxy, viewportTransform: number[]): Promise<PageLink[]> {
  const annotations = await page.getAnnotations({ intent: 'display' });
  const links: PageLink[] = [];

  for (const annotation of annotations as Record<string, unknown>[]) {
    if (annotation.subtype !== 'Link') continue;
    const url = (annotation.url ?? annotation.unsafeUrl) as string | undefined;
    const rect = annotation.rect as number[] | undefined;
    if (!url || !rect || rect.length < 4) continue;

    const [x0, y0] = Util.applyTransform([rect[0]!, rect[1]!], viewportTransform);
    const [x1, y1] = Util.applyTransform([rect[2]!, rect[3]!], viewportTransform);
    links.push({
      url,
      box: {
        x: Math.min(x0!, x1!),
        y: Math.min(y0!, y1!),
        width: Math.abs(x1! - x0!),
        height: Math.abs(y1! - y0!),
      },
    });
  }
  return links;
}

/**
 * pdf.js hands back text in runs, not words: a run can be a whole line or a
 * single ligature. We split each run on whitespace and place the pieces using
 * measured per-character advance widths, so a word in the middle of a long run
 * still lands on its glyphs.
 */
async function extractWords(
  page: PDFPageProxy,
  viewportTransform: number[],
  pageIndex: number,
): Promise<Word[]> {
  const content = await page.getTextContent({ includeMarkedContent: false });
  const words: Word[] = [];
  const boxes: { box: Box; text: string }[] = [];

  for (const raw of content.items) {
    const item = raw as TextItem;
    if (!item.str || !item.str.trim()) continue;

    const tx = Util.transform(viewportTransform, item.transform);
    const fontHeight = Math.hypot(tx[2]!, tx[3]!);
    if (fontHeight <= 0) continue;

    const runWidth = Math.abs(item.width * (tx[0]! / (item.transform[0]! || 1)));
    const width = Number.isFinite(runWidth) && runWidth > 0 ? runWidth : fontHeight * item.str.length * 0.5;
    const left = tx[4]!;
    // tx[5] is the baseline. Descenders live below it, ascenders above.
    const top = tx[5]! - fontHeight * 0.88;
    const height = fontHeight * 1.16;

    const advances = apportion(item.str, width, fontHeight, item.fontName);
    let cursor = 0;
    let offset = 0;
    for (const piece of item.str.split(/(\s+)/)) {
      if (!piece) continue;
      const pieceWidth = sum(advances, cursor, piece.length);
      if (piece.trim()) {
        boxes.push({
          text: piece,
          box: { x: left + offset, y: top, width: pieceWidth, height },
        });
      }
      cursor += piece.length;
      offset += pieceWidth;
    }
  }

  const lines = assignLines(boxes.map((b) => b.box));
  for (let i = 0; i < boxes.length; i++) {
    const entry = boxes[i]!;
    words.push({
      id: `p${pageIndex}w${i}`,
      text: entry.text,
      box: entry.box,
      page: pageIndex,
      line: lines[i]!,
    });
  }
  return sortReadingOrder(words);
}

function sum(values: number[], from: number, count: number): number {
  let total = 0;
  for (let i = from; i < from + count && i < values.length; i++) total += values[i]!;
  return total;
}

/** Group boxes into visual lines by vertical overlap. */
export function assignLines(boxes: Box[]): number[] {
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  const result = new Array<number>(boxes.length).fill(0);
  let line = -1;
  let lineTop = -Infinity;
  let lineBottom = -Infinity;

  for (const { box, index } of order) {
    const centre = box.y + box.height / 2;
    if (centre < lineTop || centre > lineBottom) {
      line++;
      lineTop = box.y;
      lineBottom = box.y + box.height;
    } else {
      lineTop = Math.min(lineTop, box.y);
      lineBottom = Math.max(lineBottom, box.y + box.height);
    }
    result[index] = line;
  }
  return result;
}

function sortReadingOrder(words: Word[]): Word[] {
  return [...words].sort((a, b) => a.line - b.line || a.box.x - b.box.x);
}
