import type { Page } from '../types.js';

/**
 * Lists the page's hyperlinks as "anchor text -> url".
 *
 * Pattern matching on the URL catches the hosts it knows, but no list of hosts
 * is ever complete: a personal domain, a new link aggregator, or a vanity
 * shortener all look ordinary. Showing the model what each visible label
 * actually points at lets it judge the ones the patterns miss, and it can then
 * quote the anchor text like any other string on the page.
 */
export function describeLinks(page: Page): string {
  if (page.links.length === 0) return '';

  const lines: string[] = [];
  const seen = new Set<string>();

  for (const link of page.links) {
    const anchor = page.words
      .filter((word) => centreInside(word.box, link.box))
      .sort((a, b) => a.box.x - b.box.x)
      .map((word) => word.text)
      .join(' ')
      .trim();

    const label = anchor || '(no visible text)';
    const entry = `${label} -> ${link.url}`;
    if (seen.has(entry)) continue;
    seen.add(entry);
    lines.push(`- ${entry}`);
  }

  if (lines.length === 0) return '';
  return `\n\nHyperlinks on this page (visible text -> destination):\n${lines.join('\n')}`;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function centreInside(inner: Rect, outer: Rect): boolean {
  const cx = inner.x + inner.width / 2;
  const cy = inner.y + inner.height / 2;
  return cx >= outer.x && cx <= outer.x + outer.width && cy >= outer.y && cy <= outer.y + outer.height;
}
