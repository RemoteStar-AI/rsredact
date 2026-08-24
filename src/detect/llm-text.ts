import type { Detection, LLMProvider, Page, ResolvedTarget } from '../types.js';
import { ProviderError } from '../errors.js';
import { buildLines, unionBox, wordsInRange, type LineText } from './lines.js';
import { describeLinks } from './link-context.js';
import { TEXT_SCHEMA, TEXT_SYSTEM, textPrompt } from './prompts.js';

/** Characters of transcript per request. CV pages are far below this. */
const MAX_CHUNK_CHARS = 12_000;

interface TextRedaction {
  line: number;
  quote: string;
  target: string;
  confidence: number;
}

export interface TextDetectionResult {
  detections: Detection[];
  calls: number;
  warnings: string[];
}

/**
 * Asks the provider which substrings to redact, then maps each quote back to
 * the words that produced it. Localisation stays exact because the model only
 * ever has to identify text, never place it.
 */
export async function detectWithText(
  page: Page,
  targets: ResolvedTarget[],
  provider: LLMProvider,
  documentContext?: string,
): Promise<TextDetectionResult> {
  const textTargets = targets.filter((t) => !t.visualOnly);
  const lines = buildLines(page);
  if (textTargets.length === 0 || lines.length === 0) {
    return { detections: [], calls: 0, warnings: [] };
  }

  const detections: Detection[] = [];
  const warnings: string[] = [];
  const linkSection = describeLinks(page);
  let calls = 0;

  for (const chunk of chunkLines(lines)) {
    // The page is pasted into the prompt inside a <page_text> fence. A CV that
    // contains the closing tag could otherwise end the fence early and have the
    // rest of its text read as instruction, so the tags are neutralised here.
    const transcript = chunk
      .map((line) => `${line.number}| ${defuse(line.text)}`)
      .join('\n');
    const base = textPrompt(textTargets, transcript, linkSection);
    const prompt = documentContext
      ? `${base}\n\nFor context, here is the whole document as text. Use it to recognise identifiers, but only return quotes from the page above.\n${documentContext}`
      : base;

    let response: { redactions?: TextRedaction[] };
    try {
      response = await provider.generateJson({
        system: TEXT_SYSTEM,
        prompt,
        schema: TEXT_SCHEMA as never,
        maxTokens: 8192,
      });
      calls++;
    } catch (error) {
      throw new ProviderError(
        `Text detection failed on page ${page.index + 1}`,
        provider.name,
        error,
      );
    }

    for (const item of response.redactions ?? []) {
      const quote = item.quote?.trim();
      if (!quote) continue;

      const matches = locate(lines, item.line, quote);
      if (matches.length === 0) {
        warnings.push(
          `page ${page.index + 1}: could not locate quote ${JSON.stringify(quote)} ` +
            `for target "${item.target}"; nothing was redacted for it`,
        );
        continue;
      }

      for (const match of matches) {
        const words = wordsInRange(match.line, match.start, match.start + quote.length);
        if (words.length === 0) continue;
        detections.push({
          page: page.index,
          target: item.target || 'unknown',
          box: unionBox(words.map((w) => w.box)),
          text: quote,
          confidence: clamp(item.confidence),
          source: 'llm-text',
          wordIds: words.map((w) => w.id),
        });
      }
    }
  }

  return { detections, calls, warnings };
}

/**
 * Looks for the quote on the line the model named. Models drift by a line or
 * two, so fall back to a page-wide search; every occurrence found is redacted,
 * since a duplicated identifier should not survive on one line and not another.
 */
function locate(
  lines: LineText[],
  lineNumber: number,
  quote: string,
): { line: LineText; start: number }[] {
  const named = lines.find((l) => l.number === lineNumber);
  if (named) {
    const hits = allIndexesOf(named.text, quote);
    if (hits.length > 0) return hits.map((start) => ({ line: named, start }));
  }

  const found: { line: LineText; start: number }[] = [];
  for (const line of lines) {
    for (const start of allIndexesOf(line.text, quote)) {
      found.push({ line, start });
    }
  }
  return found;
}

function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const index = lowerHay.indexOf(lowerNeedle, from);
    if (index === -1) break;
    out.push(index);
    from = index + Math.max(1, lowerNeedle.length);
  }
  return out;
}

function chunkLines(lines: LineText[]): LineText[][] {
  const chunks: LineText[][] = [];
  let current: LineText[] = [];
  let size = 0;
  for (const line of lines) {
    const cost = line.text.length + 8;
    if (size + cost > MAX_CHUNK_CHARS && current.length > 0) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Stops a document from closing the fence it is quoted inside. */
function defuse(text: string): string {
  return text.replace(/<\/?page_text>/gi, (match) => match.replace(/</g, '\u2039'));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
