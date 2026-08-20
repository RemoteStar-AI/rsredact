import type { Detection, Page, ResolvedTarget } from '../types.js';
import { unionBox } from './lines.js';

/**
 * Redacts hyperlink annotations.
 *
 * In 'all' mode every link goes, whatever it points at. That is the default
 * because a CV's hyperlinks are almost always the candidate's own, a host
 * allowlist can never be complete, and the anchor text is usually something
 * uninformative like "Live Link" that no amount of text analysis would flag.
 * The cost is that a link to a framework's docs also goes, which is the right
 * trade for a blind-hiring pipeline.
 *
 * In 'matching' mode only links whose URL matches a requested target are
 * redacted, which keeps unrelated links readable.
 */
export function detectLinks(
  page: Page,
  targets: ResolvedTarget[],
  mode: 'all' | 'matching' = 'all',
): Detection[] {
  if (page.links.length === 0) return [];
  const urlTargets = targets.filter((t) => t.patterns.length > 0 && !t.visualOnly);
  if (mode === 'matching' && urlTargets.length === 0) return [];

  const detections: Detection[] = [];

  for (const link of page.links) {
    if (link.box.width <= 0 || link.box.height <= 0) continue;

    const matched = urlTargets.find((target) =>
      target.patterns.some((pattern) =>
        new RegExp(pattern.source, pattern.flags.replace('g', '')).test(link.url),
      ),
    );
    if (!matched && mode === 'matching') continue;

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
