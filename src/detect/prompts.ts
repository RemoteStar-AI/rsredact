import type { ResolvedTarget } from '../types.js';

function targetList(targets: ResolvedTarget[]): string {
  return targets.map((t) => `- ${t.id}: ${t.description}`).join('\n');
}

export const TEXT_SYSTEM =
  'You are a redaction engine for a blind-hiring pipeline. You are given the text of ' +
  'one page of a CV, line by line. You return the exact substrings that must be ' +
  'covered before a hiring manager sees the page. You never rewrite, summarise, or ' +
  'comment on the CV. Quote substrings character-for-character from the line you name, ' +
  'including punctuation, so they can be located again. Prefer several small quotes ' +
  'over one large one: everything you quote gets blacked out, so quoting a whole line ' +
  'to catch one word destroys information the reviewer needs.';

export function textPrompt(
  targets: ResolvedTarget[],
  transcript: string,
  links = '',
): string {
  return `Find every occurrence of these targets on this CV page.

Targets:
${targetList(targets)}

Rules:
- Return one entry per occurrence. The same target can appear many times.
- \`quote\` must be copied verbatim from the line you reference. Do not normalise spacing, case, or punctuation.
- \`quote\` must be the identifying text only. For "Email: jane@example.com" quote the address, not the label.
- If a name or address wraps across two lines, return one entry per line.
- Skip anything already unidentifiable.
- A hyperlink section may follow the page text. Anchor text like "Portfolio", "Linktree", or "Live Link" reveals nothing on its own, but if the URL behind it identifies the candidate (their username, their name, a personal site, a link aggregator), quote the visible anchor text so it gets covered.
- Set confidence to 0.9 or above only when you are sure. Use 0.5-0.8 when the text is ambiguous.
- Return an empty list if the page contains none of the targets.

Page text:
${transcript}${links}`;
}

export const TEXT_SCHEMA = {
  name: 'cv_text_redactions',
  description: 'Substrings on a CV page that must be redacted.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['redactions'],
    properties: {
      redactions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['line', 'quote', 'target', 'confidence'],
          properties: {
            line: { type: 'integer', description: 'Line number the quote appears on.' },
            quote: { type: 'string', description: 'Exact substring to redact.' },
            target: { type: 'string', description: 'Which target this is.' },
            confidence: { type: 'number', description: 'Between 0 and 1.' },
          },
        },
      },
    },
  },
} as const;

export const VISION_SYSTEM =
  'You are a redaction engine for a blind-hiring pipeline. You are shown one page of a ' +
  'CV with a magenta reference grid drawn over it. Columns are lettered along the top ' +
  'and bottom margins, rows are numbered down the left and right margins. You locate ' +
  'the regions that must be covered and name them as two opposite corner cells of a ' +
  'rectangle. The grid is a measuring tool that was added to the page; never treat it ' +
  'as part of the CV.';

export function visionPrompt(
  targets: ResolvedTarget[],
  cols: number,
  rows: number,
  lastColumn: string,
): string {
  return `Find every occurrence of these targets on this CV page.

Targets:
${targetList(targets)}

The grid has ${cols} columns (A to ${lastColumn}) and ${rows} rows (1 to ${rows}).

Rules:
- Give \`from\` as the top-left cell and \`to\` as the bottom-right cell of the smallest rectangle that fully covers the item, in spreadsheet notation like "C4".
- Use the tightest rectangle that works. A rectangle that spills onto neighbouring text blacks that text out too.
- One entry per occurrence. Do not merge two separate items into one rectangle.
- For a photograph, cover the whole photo including its border.
- Set confidence to 0.9 or above only when you are sure.
- Return an empty list if the page contains none of the targets.`;
}

export const VISION_SCHEMA = {
  name: 'cv_grid_redactions',
  description: 'Grid rectangles on a CV page that must be redacted.',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['redactions'],
    properties: {
      redactions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['target', 'from', 'to', 'confidence'],
          properties: {
            target: { type: 'string', description: 'Which target this is.' },
            from: { type: 'string', description: 'Top-left cell, e.g. "C4".' },
            to: { type: 'string', description: 'Bottom-right cell, e.g. "F6".' },
            confidence: { type: 'number', description: 'Between 0 and 1.' },
          },
        },
      },
    },
  },
} as const;
