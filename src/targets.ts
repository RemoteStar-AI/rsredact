import type { CustomTarget, ResolvedTarget, TargetInput } from './types.js';

/**
 * Patterns are deliberately broad. A false positive costs a black box over a
 * word; a false negative leaks a candidate's phone number.
 */
const EMAIL = /[A-Z0-9._%+-]+\s?@\s?[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** International, US, Indian, and UK-ish shapes, 7-15 digits with separators. */
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]?\d{2,5}){1,4}\b/g;

const URL = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;

/**
 * Known profile and link-aggregator hosts. An aggregator is the worst single
 * leak on a CV, because one link fans out to every other profile. This list can
 * never be complete, which is why link URLs are also shown to the model rather
 * than relying on it alone.
 */
const SOCIAL =
  /\b(?:(?:https?:\/\/)?(?:[a-z]{2,3}\.)?(?:linkedin\.com|github\.com|gitlab\.com|bitbucket\.org|twitter\.com|x\.com|behance\.net|dribbble\.com|medium\.com|stackoverflow\.com|kaggle\.com|instagram\.com|facebook\.com|t\.me|linktr\.ee|bento\.me|beacons\.ai|carrd\.co|about\.me|bio\.link|substack\.com|dev\.to|hashnode\.dev|leetcode\.com|hackerrank\.com|codeforces\.com|codechef\.com|npmjs\.com|producthunt\.com|youtube\.com|threads\.net|mastodon\.social|bsky\.app)\/[^\s<>"')]*)/gi;

const DOB =
  /\b(?:d\.?o\.?b\.?|date\s+of\s+birth|born)\b[^\n]{0,40}|\b(?:0?[1-9]|[12]\d|3[01])[\/.\-](?:0?[1-9]|1[0-2])[\/.\-](?:19|20)\d{2}\b/gi;

const BUILTINS: Record<string, CustomTarget> = {
  name: {
    id: 'name',
    description:
      "The candidate's own personal name, wherever it appears: the header, a footer, the file title block, an email signature, or inside a self-referential sentence. Do not include names of companies, universities, technologies, or other people (managers, referees are handled separately).",
  },
  email: {
    id: 'email',
    description: 'Any email address belonging to the candidate.',
    patterns: [EMAIL],
  },
  phone: {
    id: 'phone',
    description:
      'Any telephone or mobile number, including country codes and any label like "Mob:" that carries it.',
    patterns: [PHONE],
  },
  address: {
    id: 'address',
    description:
      'Postal or residential address, including street, city, state, postcode, and country when they appear as the candidate\'s location. Do not redact employer or university locations.',
  },
  social: {
    id: 'social',
    description:
      'Links or handles for LinkedIn, GitHub, X/Twitter, personal sites, portfolios, or any other social profile.',
    patterns: [SOCIAL],
  },
  url: {
    id: 'url',
    description: 'Any URL that could identify the candidate.',
    patterns: [URL],
  },
  photo: {
    id: 'photo',
    description:
      "A photograph or avatar of the candidate. This is a face or headshot, not a company logo, icon, or chart.",
    visualOnly: true,
  },
  signature: {
    id: 'signature',
    description: 'A handwritten signature.',
    visualOnly: true,
  },
  dob: {
    id: 'dob',
    description: 'Date of birth or age.',
    patterns: [DOB],
  },
  nationality: {
    id: 'nationality',
    description:
      'Nationality, citizenship, visa status, or country of origin stated about the candidate.',
  },
  gender: {
    id: 'gender',
    description: 'Gender, sex, or pronouns stated about the candidate.',
  },
  marital_status: {
    id: 'marital_status',
    description: 'Marital status, spouse, or dependents.',
  },
  employer: {
    id: 'employer',
    description:
      'Names of companies the candidate worked for. Keep the job titles, dates, and descriptions; redact only the organisation name.',
  },
  school: {
    id: 'school',
    description:
      'Names of universities, colleges, and schools attended. Keep the degree and dates; redact only the institution name.',
  },
  reference: {
    id: 'reference',
    description:
      'Names and contact details of referees or other third parties named in the CV.',
  },
};

export function builtinTargetIds(): string[] {
  return Object.keys(BUILTINS);
}

export function resolveTargets(inputs: TargetInput[]): ResolvedTarget[] {
  const seen = new Set<string>();
  const out: ResolvedTarget[] = [];

  for (const input of inputs) {
    const spec = typeof input === 'string' ? BUILTINS[input] : input;
    if (!spec) {
      throw new Error(
        `Unknown target "${input}". Known targets: ${builtinTargetIds().join(', ')}. ` +
          'Pass an object { id, description } to define your own.',
      );
    }
    if (seen.has(spec.id)) continue;
    seen.add(spec.id);
    out.push({
      id: spec.id,
      description: spec.description,
      patterns: spec.patterns ?? [],
      visualOnly: spec.visualOnly ?? false,
    });
  }
  return out;
}
