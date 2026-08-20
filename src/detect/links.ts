import type { Detection, Page, ResolvedTarget } from '../types.js';
import { unionBox } from './lines.js';

/**
 * Decides which hyperlinks should have their *visible text* painted over.
 *
 * Every hyperlink is already dead by the time output is written, because the
 * PDF is rebuilt from rendered pages and no annotation survives. So this is not
 * about neutralising the link, it is only about whether the reader can still
 * read the words. Usually they should: a dead link to an employer's site is
 * just the employer's name, and a dead link behind "CKA" is just a
 * certification. Hiding those destroys content for no privacy gain.
 *
 * 'keep'                nothing here redacts link text.
 * 'redact-identifying'  hide it when the destination matches a requested target.
 * 'redact-all'          hide it for every link.
 */
export function detectLinks(
  page: Page,
  targets: ResolvedTarget[],
  policy: 'keep' | 'redact-identifying' | 'redact-all' = 'keep',
): Detection[] {
  if (policy === 'keep' || page.links.length === 0) return [];
  const urlTargets = targets.filter((t) => t.patterns.length > 0 && !t.visualOnly);

  const detections: Detection[] = [];

  for (const link of page.links) {
    if (link.box.width <= 0 || link.box.height <= 0) continue;

    const matched = urlTargets.find((target) =>
      target.patterns.some((pattern) =>
        new RegExp(pattern.source, pattern.flags.replace('g', '')).test(link.url),
      ),
    );
    if (!matched && policy === 'redact-identifying') continue;

    // The annotation rect is often padded well past the glyphs. When the words
    // underneath are known, use them instead.
    const covered = page.words.filter((word) => centreInside(word.box, link.box));
    const box = covered.length > 0 ? unionBox(covered.map((w) => w.box)) : link.box;

    detections.push({
      page: page.index,
      target: matched?.id ?? 'link',
      box,
      text: link.url,
      confidence: 1,
      source: 'link',
      wordIds: covered.map((w) => w.id),
    });
  }
  return detections;
}

function centreInside(inner: { x: number; y: number; width: number; height: number }, outer: {
  x: number;
  y: number;
  width: number;
  height: number;
}): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}
