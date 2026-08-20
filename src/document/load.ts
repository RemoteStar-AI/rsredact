import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { LoadedDocument, Page, RedactOptions } from '../types.js';
import { MissingDependencyError, UnsupportedInputError } from '../errors.js';
import { loadPdf } from './pdf.js';
import { ocrPage } from './ocr.js';

export const DEFAULT_DPI = 150;

type Kind = 'pdf' | 'image';

function sniff(data: Buffer): Kind {
  if (data.length > 4 && data.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (data.length > 8 && data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image';
  if (data.length > 12 && data.subarray(0, 4).toString('latin1') === 'RIFF') return 'image';
  throw new UnsupportedInputError(
    'Input is not a PDF, PNG, JPEG, or WebP. DOCX and other office formats must be ' +
      'converted to PDF before redaction (their text is reflowable, so it has no fixed coordinates).',
  );
}

export async function loadDocument(
  data: Buffer,
  options: RedactOptions,
): Promise<LoadedDocument> {
  const dpi = options.dpi ?? DEFAULT_DPI;
  const kind = sniff(data);
  options.onProgress?.({ stage: 'load', message: `reading ${kind}` });

  const warnings: string[] = [];
  let pages: Page[];
  let pointSizes: { width: number; height: number }[] | undefined;

  if (kind === 'pdf') {
    const rendered = await loadPdf(data, dpi);
    pages = rendered.pages;
    pointSizes = rendered.pointSizes;
  } else {
    pages = [await loadRasterPage(data)];
  }

  if (options.ocr !== false) {
    for (const page of pages) {
      if (page.words.length > 0) continue;
      options.onProgress?.({
        stage: 'ocr',
        page: page.index,
        totalPages: pages.length,
        message: 'no text layer, running OCR',
      });
      try {
        await ocrPage(page, options.ocrLanguage ?? 'eng');
      } catch (error) {
        // A missing OCR engine should not fail the whole document: in auto mode
        // a page with no text falls through to vision detection anyway.
        if (!(error instanceof MissingDependencyError)) throw error;
        warnings.push(`${error.message} Falling back to vision detection for this page.`);
        break;
      }
    }
  }

  return { pages, pointSizes, kind, dpi, warnings };
}

async function loadRasterPage(data: Buffer): Promise<Page> {
  const image = await loadImage(data);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  return {
    index: 0,
    width: image.width,
    height: image.height,
    image: canvas.toBuffer('image/png'),
    words: [],
    textSource: 'none',
    links: [],
  };
}
