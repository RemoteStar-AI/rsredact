import type {
  AuditRecord,
  Detection,
  LoadedDocument,
  RedactOptions,
  RedactResult,
  ResolvedTarget,
} from './types.js';
import { resolveTargets } from './targets.js';
import { DEFAULT_DPI, loadDocument } from './document/load.js';
import { detectPatterns } from './detect/patterns.js';
import { detectLinks } from './detect/links.js';
import { detectVisibleUrls } from './detect/urls.js';
import { detectWithText } from './detect/llm-text.js';
import { detectWithVision } from './detect/llm-vision.js';
import { mergeDetections, padDetections } from './detect/merge.js';
import { buildPdf, paintPages } from './redact/apply.js';
import { fetchRsparseMarkdown } from './rsparse.js';

/**
 * Finds and removes the requested identifiers from a CV.
 *
 * Accepts a PDF, PNG, JPEG, or WebP. Returns a redacted PDF whose pages are
 * images, so the redacted text is gone rather than covered.
 */
export async function redact(input: Buffer, options: RedactOptions): Promise<RedactResult> {
  const started = Date.now();
  const targets = resolveTargets(options.targets);
  const warnings: string[] = [];

  const document = await loadDocument(input, options);
  warnings.push(...document.warnings);
  const documentContext = await maybeFetchContext(input, options, warnings);

  const detections: Detection[] = [];
  let llmCalls = 0;

  for (const page of document.pages) {
    options.onProgress?.({
      stage: 'detect-patterns',
      page: page.index,
      totalPages: document.pages.length,
    });
    detections.push(...detectPatterns(page, targets));

    const linkMode = options.links ?? 'all';
    if (linkMode !== 'none') {
      detections.push(...detectLinks(page, targets, linkMode));
    }
    if (linkMode === 'all') {
      detections.push(...detectVisibleUrls(page));
    }

    const plan = planPage(page.words.length > 0, targets, options.mode ?? 'auto');

    if (plan.text && options.provider) {
      options.onProgress?.({
        stage: 'detect-text',
        page: page.index,
        totalPages: document.pages.length,
      });
      const result = await detectWithText(page, targets, options.provider, documentContext);
      detections.push(...result.detections);
      warnings.push(...result.warnings);
      llmCalls += result.calls;
    }

    if (plan.vision && options.provider) {
      options.onProgress?.({
        stage: 'detect-vision',
        page: page.index,
        totalPages: document.pages.length,
      });
      const result = await detectWithVision(
        page,
        plan.visionTargets,
        options.provider,
        options.grid,
      );
      detections.push(...result.detections);
      warnings.push(...result.warnings);
      llmCalls += result.calls;
    }

    if ((plan.text || plan.vision) && !options.provider) {
      warnings.push(
        `page ${page.index + 1}: no provider was passed, so only pattern and link ` +
          'detection ran. Targets that need judgement (name, address, employer) were not found.',
      );
    }
    if (page.words.length === 0 && !plan.vision) {
      warnings.push(
        `page ${page.index + 1}: no text could be read and vision detection did not run, ` +
          'so nothing on this page was checked.',
      );
    }
  }

  const pageSizes = document.pages.map((page) => ({ width: page.width, height: page.height }));
  const merged = padDetections(
    mergeDetections(detections, options.minConfidence ?? 0.5),
    options.padding ?? 2,
    pageSizes,
  );

  options.onProgress?.({ stage: 'apply', totalPages: document.pages.length });
  const painted = await paintPages(document, merged, options.style ?? 'box');
  warnings.push(...painted.warnings);

  const output = options.output ?? 'pdf';
  const result: RedactResult = {
    detections: merged,
    audit: buildAudit({
      targets,
      options,
      document,
      detections: merged,
      llmCalls,
      warnings,
      durationMs: Date.now() - started,
    }),
  };

  if (output === 'pdf' || output === 'both') {
    result.pdf = await buildPdf(painted.images, document);
  }
  if (output === 'images' || output === 'both') {
    result.images = painted.images;
  }
  return result;
}

interface PagePlan {
  text: boolean;
  vision: boolean;
  visionTargets: ResolvedTarget[];
}

/**
 * Text detection is preferred wherever there is text: the model only has to
 * recognise an identifier, never place it, so the box comes from the document's
 * own coordinates. Vision is for what text cannot answer — photos and
 * signatures — and for pages that have no readable text at all.
 */
function planPage(hasText: boolean, targets: ResolvedTarget[], mode: string): PagePlan {
  const visual = targets.filter((t) => t.visualOnly);
  const textual = targets.filter((t) => !t.visualOnly);

  switch (mode) {
    case 'patterns-only':
      return { text: false, vision: false, visionTargets: [] };
    case 'text':
      return { text: textual.length > 0 && hasText, vision: false, visionTargets: [] };
    case 'vision':
      return { text: false, vision: true, visionTargets: targets };
    default:
      return {
        text: textual.length > 0 && hasText,
        vision: visual.length > 0 || (!hasText && targets.length > 0),
        visionTargets: hasText ? visual : targets,
      };
  }
}

async function maybeFetchContext(
  input: Buffer,
  options: RedactOptions,
  warnings: string[],
): Promise<string | undefined> {
  if (!options.rsparseUrl) return undefined;
  options.onProgress?.({ stage: 'parse-context', message: 'fetching markdown from rsparse' });
  try {
    const markdown = await fetchRsparseMarkdown(
      options.rsparseUrl,
      input,
      'application/octet-stream',
    );
    return markdown.trim() || undefined;
  } catch (error) {
    warnings.push(
      `rsparse context unavailable (${(error as Error).message}); detection continued without it`,
    );
    return undefined;
  }
}

function buildAudit(input: {
  targets: ResolvedTarget[];
  options: RedactOptions;
  document: LoadedDocument;
  detections: Detection[];
  llmCalls: number;
  warnings: string[];
  durationMs: number;
}): AuditRecord {
  const counts: Record<string, number> = {};
  for (const detection of input.detections) {
    counts[detection.target] = (counts[detection.target] ?? 0) + 1;
  }
  return {
    targets: input.targets.map((t) => t.id),
    mode: input.options.mode ?? 'auto',
    links: input.options.links ?? 'all',
    provider: input.options.provider?.name,
    pages: input.document.pages.length,
    dpi: input.options.dpi ?? DEFAULT_DPI,
    textSources: [...new Set(input.document.pages.map((page) => page.textSource))],
    detectionCounts: counts,
    llmCalls: input.llmCalls,
    durationMs: input.durationMs,
    warnings: [...new Set(input.warnings)],
  };
}
