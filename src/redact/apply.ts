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
      `style "${style}" throws the detail away by downsampling before it smooths, so the ` +
        'characters themselves cannot be read back out of the output. What it does still ' +
        'show is the shape of what was covered: how many words, how long they were, and ' +
        'where the lines broke. Use "box" when none of that should be inferable.',
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
        blurBox(ctx, box);
        break;
      case 'pixelate':
        pixelate(ctx, box);
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

/** How much detail the downsample throws away before anything is smoothed. */
const DETAIL_FACTOR = 12;

/**
 * Downscales the region and draws it back at full size with smoothing off, so
 * the region becomes visible blocks.
 */
function pixelate(ctx: SKRSContext2D, box: Box): void {
  const small = downsample(ctx, box, box);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small as never, 0, 0, small.width, small.height, box.x, box.y, box.width, box.height);
  ctx.imageSmoothingEnabled = true;
}

/**
 * Frosts the region: the detail is thrown away by downsampling, then a real
 * gaussian pass smooths what is left.
 *
 * The two steps do different jobs. The downsample is the one that matters,
 * because at a twelfth of the original size there is no glyph left to sharpen
 * back up. The blur is cosmetic, and it is the difference between something
 * that looks deliberate and something that looks like a broken thumbnail.
 *
 * The blur reads a padded region rather than the box alone. Blurring the box on
 * its own samples transparency past its edges, which leaves a pale halo just
 * inside the border and makes the box look like a sticker.
 */
function blurBox(ctx: SKRSContext2D, box: Box): void {
  // Tied to the height of what is being covered, so a page rendered at 300 dpi
  // gets the same apparent softness as one at 150.
  const radius = Math.max(3, Math.round(box.height * 0.32));
  const pad = radius * 2;

  const source = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: 0,
    height: 0,
  };
  source.width = Math.min(ctx.canvas.width - source.x, box.width + pad * 2);
  source.height = Math.min(ctx.canvas.height - source.y, box.height + pad * 2);
  if (source.width <= 0 || source.height <= 0) return;

  const coarse = downsample(ctx, source, source);
  const frosted = createCanvas(source.width, source.height);
  const frostedCtx = frosted.getContext('2d');
  frostedCtx.drawImage(
    coarse as never,
    0,
    0,
    coarse.width,
    coarse.height,
    0,
    0,
    source.width,
    source.height,
  );

  const blurred = createCanvas(source.width, source.height);
  const blurredCtx = blurred.getContext('2d');
  blurredCtx.filter = `blur(${radius}px)`;
  blurredCtx.drawImage(frosted as never, 0, 0);
  blurredCtx.filter = 'none';

  // Only the box is written back. The padding was scaffolding for the blur.
  ctx.drawImage(
    blurred as never,
    box.x - source.x,
    box.y - source.y,
    box.width,
    box.height,
    box.x,
    box.y,
    box.width,
    box.height,
  );
}

/** The region at a twelfth of its size, which is where the detail is lost. */
function downsample(ctx: SKRSContext2D, from: Box, size: Box) {
  const small = createCanvas(
    Math.max(1, Math.floor(size.width / DETAIL_FACTOR)),
    Math.max(1, Math.floor(size.height / DETAIL_FACTOR)),
  );
  small
    .getContext('2d')
    .drawImage(
      ctx.canvas as never,
      from.x,
      from.y,
      from.width,
      from.height,
      0,
      0,
      small.width,
      small.height,
    );
  return small;
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
