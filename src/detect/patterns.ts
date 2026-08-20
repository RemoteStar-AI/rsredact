import type { Detection, Page, ResolvedTarget } from '../types.js';
import { buildLines, unionBox, wordsInRange } from './lines.js';

/**
 * Regexes alone are too eager for some targets. A phone pattern will happily
 * eat "2019 - 2021" out of an experience section, and blacking out every date
 * range makes a CV useless. Guards run after the match and veto it.
 */
const GUARDS: Record<string, (match: string, line: string, index: number) => boolean> = {
  phone: (match, line, index) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return false;

    // Two four-digit years with a separator is a date range, not a number.
    if (/\b(19|20)\d{2}\b[^\d]{1,3}\b(19|20)\d{2}\b/.test(match)) return false;
    // A single year, a percentage, or a money figure.
    if (/^\s*(19|20)\d{2}\s*$/.test(match)) return false;
    const after = line.slice(index + match.length, index + match.length + 2);
    if (/^\s*%/.test(after)) return false;

    const before = line.slice(Math.max(0, index - 24), index).toLowerCase();
    const labelled = /(phone|mobile|mob|tel|cell|contact|whatsapp|call)/.test(before);
    const international = /^\s*\+/.test(match);
    return labelled || international || digits.length >= 9;
  },
  dob: (match) => match.trim().length > 3,
};

export function detectPatterns(page: Page, targets: ResolvedTarget[]): Detection[] {
  const lines = buildLines(page);
  const detections: Detection[] = [];

  for (const target of targets) {
    if (target.patterns.length === 0) continue;

    for (const line of lines) {
      for (const pattern of target.patterns) {
        const regex = new RegExp(pattern.source, ensureGlobal(pattern.flags));
        for (const match of line.text.matchAll(regex)) {
          const raw = match[0];
          if (!raw || !raw.trim()) continue;
          const index = match.index ?? 0;

          const guard = GUARDS[target.id];
          if (guard && !guard(raw, line.text, index)) continue;

          // Trim whitespace the pattern may have swallowed at the edges.
          const leading = raw.length - raw.trimStart().length;
          const start = index + leading;
          const end = start + raw.trim().length;

          const words = wordsInRange(line, start, end);
          if (words.length === 0) continue;

          detections.push({
            page: page.index,
            target: target.id,
            box: unionBox(words.map((w) => w.box)),
            text: raw.trim(),
            confidence: 1,
            source: 'pattern',
            wordIds: words.map((w) => w.id),
          });
        }
      }
    }
  }
  return detections;
}

function ensureGlobal(flags: string): string {
  return flags.includes('g') ? flags : `${flags}g`;
}
