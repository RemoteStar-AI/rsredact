import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import type { Box, Detection, LoadedDocument, Page, RedactionStyle } from '../types.js';

const PDF_POINTS_PER_INCH = 72;

export interface PaintResult {
  images: Buffer[];
  warnings: string[];
}

export async function paintPages(
  document: LoadedDocument,
  detections: Detection[],
  style: RedactionStyle,
): Promise<PaintResult> {
  const warnings: string[] = [];
  if (style === 'blur' || style === 'pixelate') {
    warnings.push(
      `style "${style}" obscures text but does not destroy it: blurred and pixelated text ` +
        'can often be recovered. Use "box" or "label" when the output leaves your control.',
    );
  }

  const byPage = new Map<number, Detection[]>();
  for (const detection of detections) {
    const bucket = byPage.get(detection.page);
    if (bucket) bucket.push(detection);
    else byPage.set(detection.page, [detection]);
  }

  const images: Buffer[] = [];
  for (const page of document.pages) {
    images.push(await paintPage(page, byPage.get(page.index) ?? [], style));
  }
  return { images, warnings };
}

async function paintPage(page: Page, detections: Detection[], style: RedactionStyle): Promise<Buffer> {
  const canvas = createCanvas(page.width, page.height);
  const ctx = canvas.getContext('2d');
  const image = await loadImage(page.image);
  ctx.drawImage(image, 0, 0, page.width, page.height);

  for (const detection of detections) {
    const box = round(detection.box);
    if (box.width <= 0 || box.height <= 0) continue;
    switch (style) {
      case 'box':
        fillBox(ctx, box);
        break;
      case 'label':
        fillBox(ctx, box);
        drawLabel(ctx, box, detection.target);
        break;
      case 'blur':
        scramble(ctx, box, true);
        break;
      case 'pixelate':
        scramble(ctx, box, false);
        break;
    }
  }

  return canvas.toBuffer('image/png');
}

function fillBox(ctx: SKRSContext2D, box: Box): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(box.x, box.y, box.width, box.height);
}

function drawLabel(ctx: SKRSContext2D, box: Box, target: string): void {
  const fontSize = Math.min(Math.floor(box.height * 0.7), 14);
  if (fontSize < 6) return;
  ctx.font = `600 ${fontSize}px sans-serif`;
  const text = target.toUpperCase();
  if (ctx.measureText(text).width > box.width - 4) return;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Downscales the region and draws it back at full size. With smoothing on that
 * reads as a blur; with smoothing off it reads as pixelation.
 */
function scramble(ctx: SKRSContext2D, box: Box, smooth: boolean): void {
  const factor = 12;
  const small = createCanvas(
    Math.max(1, Math.floor(box.width / factor)),
    Math.max(1, Math.floor(box.height / factor)),
  );
  const smallCtx = small.getContext('2d');
  smallCtx.drawImage(
    ctx.canvas as never,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    small.width,
    small.height,
  );
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(small as never, 0, 0, small.width, small.height, box.x, box.y, box.width, box.height);
  ctx.imageSmoothingEnabled = true;
}

/**
 * Rebuilds a PDF from the painted rasters. This is the step that makes the
 * redaction real: the original text objects are gone rather than hidden under a
 * rectangle, so nothing can be selected, copied, or recovered from the output.
 * Document metadata is cleared too, because the author field of a CV is very
 * often the candidate's own name.
 */
export async function buildPdf(images: Buffer[], document: LoadedDocument): Promise<Buffer> {
  const pdf = await PDFDocument.create();

  for (let i = 0; i < images.length; i++) {
    const embedded = await pdf.embedPng(images[i]!);
    const points = document.pointSizes?.[i];
    const width = points?.width ?? (embedded.width * PDF_POINTS_PER_INCH) / document.dpi;
    const height = points?.height ?? (embedded.height * PDF_POINTS_PER_INCH) / document.dpi;
    const page = pdf.addPage([width, height]);
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }

  pdf.setTitle('');
  pdf.setAuthor('');
  pdf.setSubject('');
  pdf.setKeywords([]);
  pdf.setCreator('RS Redact');
  pdf.setProducer('RS Redact');

  return Buffer.from(await pdf.save());
}

function round(box: Box): Box {
  const x = Math.floor(box.x);
  const y = Math.floor(box.y);
  return {
    x,
    y,
    width: Math.ceil(box.x + box.width) - x,
    height: Math.ceil(box.y + box.height) - y,
  };
}
