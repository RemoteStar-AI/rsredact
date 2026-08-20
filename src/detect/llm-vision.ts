import type { Box, Detection, LLMProvider, Page, ResolvedTarget, GridOptions } from '../types.js';
import { ProviderError } from '../errors.js';
import { unionBox } from './lines.js';
import {
  DEFAULT_GRID,
  cellRangeToBox,
  columnLabel,
  drawGridOverlay,
  makeGrid,
  parseCell,
  type Grid,
} from './grid.js';
import { VISION_SCHEMA, VISION_SYSTEM, visionPrompt } from './prompts.js';

interface GridRedaction {
  target: string;
  from: string;
  to: string;
  confidence: number;
}

export interface VisionDetectionResult {
  detections: Detection[];
  calls: number;
  warnings: string[];
  /** The grid image that was sent, for debugging. */
  overlay: Buffer;
}

export async function detectWithVision(
  page: Page,
  targets: ResolvedTarget[],
  provider: LLMProvider,
  gridOptions: GridOptions | undefined,
): Promise<VisionDetectionResult> {
  if (!provider.supportsVision) {
    throw new ProviderError(
      `Provider "${provider.name}" cannot read images, so vision mode is unavailable. ` +
        'Use mode "text", or pass a provider with supportsVision.',
      provider.name,
    );
  }

  const grid = makeGrid(page, gridOptions);
  const overlay = await drawGridOverlay(page, grid, gridOptions);
  const warnings: string[] = [];

  let response: { redactions?: GridRedaction[] };
  try {
    response = await provider.generateJson({
      system: VISION_SYSTEM,
      prompt: visionPrompt(targets, grid.cols, grid.rows, columnLabel(grid.cols - 1)),
      images: [{ mediaType: 'image/png', data: overlay.toString('base64') }],
      schema: VISION_SCHEMA as never,
      maxTokens: 4096,
    });
  } catch (error) {
    throw new ProviderError(
      `Vision detection failed on page ${page.index + 1}`,
      provider.name,
      error,
    );
  }

  const snap = gridOptions?.snapToWords ?? DEFAULT_GRID.snapToWords;
  const detections: Detection[] = [];

  for (const item of response.redactions ?? []) {
    const from = parseCell(item.from ?? '');
    const to = parseCell(item.to ?? '');
    if (!from || !to) {
      warnings.push(
        `page ${page.index + 1}: unreadable grid reference "${item.from}":"${item.to}" ` +
          `for target "${item.target}"; nothing was redacted for it`,
      );
      continue;
    }

    const cellBox = cellRangeToBox(grid, from, to);
    const confidence = clamp(item.confidence);
    const target = item.target || 'unknown';

    const refined = snap ? snapToWords(page, cellBox) : [];
    if (refined.length > 0) {
      for (const hit of refined) {
        detections.push({
          page: page.index,
          target,
          box: hit.box,
          text: hit.text,
          confidence,
          source: 'llm-vision',
          wordIds: hit.wordIds,
        });
      }
    } else {
      detections.push({
        page: page.index,
        target,
        box: clampBox(cellBox, grid),
        confidence,
        source: 'llm-vision',
      });
    }
  }

  return { detections, calls: 1, warnings, overlay };
}

/**
 * A grid cell is coarse by construction: at 24x36 on A4 a cell is still about
 * two lines of body text tall. When we know where the words are, shrink the
 * model's rectangle to the words actually inside it, one box per line. That
 * keeps the model's job easy (point at a region) without paying for it in
 * over-redaction.
 */
function snapToWords(
  page: Page,
  region: Box,
): { box: Box; text: string; wordIds: string[] }[] {
  const inside = page.words.filter((word) => overlapRatio(word.box, region) > 0.5);
  if (inside.length === 0) return [];

  const byLine = new Map<number, typeof inside>();
  for (const word of inside) {
    const bucket = byLine.get(word.line);
    if (bucket) bucket.push(word);
    else byLine.set(word.line, [word]);
  }

  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, words]) => {
      const ordered = words.sort((a, b) => a.box.x - b.box.x);
      return {
        box: unionBox(ordered.map((w) => w.box)),
        text: ordered.map((w) => w.text).join(' '),
        wordIds: ordered.map((w) => w.id),
      };
    });
}

/** Fraction of `inner` that lies within `outer`. */
function overlapRatio(inner: Box, outer: Box): number {
  const width = Math.min(inner.x + inner.width, outer.x + outer.width) - Math.max(inner.x, outer.x);
  const height =
    Math.min(inner.y + inner.height, outer.y + outer.height) - Math.max(inner.y, outer.y);
  if (width <= 0 || height <= 0) return 0;
  const area = inner.width * inner.height;
  if (area <= 0) return 0;
  return (width * height) / area;
}

function clampBox(box: Box, grid: Grid): Box {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  return {
    x,
    y,
    width: Math.min(box.width, grid.pageWidth - x),
    height: Math.min(box.height, grid.pageHeight - y),
  };
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
