import type { Detection, Page } from '../types.js';
import { buildLines, unionBox, wordsInRange } from './lines.js';

/**
 * Finds URLs written as visible text, whether or not anything links to them.
 *
 * A CV writes web addresses three ways: as a real hyperlink, as a full URL in
 * the text, and as a bare domain with no scheme ("github.com/someone"). Only
 * the first is an annotation, so the other two need matching on the text.
 */

/** With a scheme or a www prefix there is no ambiguity. */
const EXPLICIT = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;

/**
 * A bare domain followed by a path: the slash is what makes it unambiguous.
 * The lookbehind keeps this from firing on the host half of an email address,
 * which the email target already covers in full.
 */
const WITH_PATH =
  /(?<![@\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\/[^\s<>"')\]]*/gi;

/**
 * A bare domain with no path is genuinely ambiguous: "Node.js", "Next.js" and
 * "main.py" all look like domains. Requiring a real top-level domain from a
 * fixed list is what separates "ghstmail.space" from "Node.js". Extensions that
 * collide with a TLD (.sh, .app) are the accepted cost of not missing a domain.
 */
const BARE_TLDS = [
  'com',
  'org',
  'net',
  'edu',
  'gov',
  'io',
  'dev',
  'ai',
  'me',
  'co',
  'in',
  'uk',
  'us',
  'eu',
  'app',
  'xyz',
  'tech',
  'space',
  'site',
  'online',
  'live',
  'page',
  'link',
  'blog',
  'cloud',
  'digital',
  'ee',
  'sh',
  'gg',
  'so',
  'to',
];

const BARE_DOMAIN = new RegExp(
  `(?<![@\\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${BARE_TLDS.join('|')})\\b`,
  'gi',
);

const PATTERNS = [EXPLICIT, WITH_PATH, BARE_DOMAIN];

export function detectVisibleUrls(page: Page): Detection[] {
  const lines = buildLines(page);
  const detections: Detection[] = [];

  for (const line of lines) {
    for (const pattern of PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      for (const match of line.text.matchAll(regex)) {
        const raw = match[0];
        if (!raw || match.index === undefined) continue;

        // Trailing sentence punctuation is not part of the address.
        const trimmed = raw.replace(/[.,;:)\]]+$/, '');
        if (trimmed.length < 4) continue;

        const words = wordsInRange(line, match.index, match.index + trimmed.length);
        if (words.length === 0) continue;

        detections.push({
          page: page.index,
          target: 'url',
          box: unionBox(words.map((w) => w.box)),
          text: trimmed,
          confidence: 1,
          source: 'pattern',
          wordIds: words.map((w) => w.id),
        });
      }
    }
  }
  return detections;
}
