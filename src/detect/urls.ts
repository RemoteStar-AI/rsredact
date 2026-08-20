/**
 * Patterns for URLs written out as visible text.
 *
 * A CV writes web addresses three ways: as a real hyperlink, as a full URL in
 * the text, and as a bare domain with no scheme ("github.com/someone"). Only
 * the first is an annotation; these patterns cover the other two, which are
 * identifying content in their own right because the reader can just type them.
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

/** Ordered broadest-first. Overlapping matches merge downstream. */
export const URL_TEXT_PATTERNS = [EXPLICIT, WITH_PATH, BARE_DOMAIN];
