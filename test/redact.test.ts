import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { redact } from '../src/index.js';
import { scriptedProvider } from '../src/providers/index.js';
import { buildSampleCv } from './fixture.js';

const DPI = 150;
const POINTS_PER_INCH = 72;

test('patterns find the email and phone with no provider at all', async () => {
  const { bytes } = await buildSampleCv();
  const result = await redact(bytes, {
    targets: ['email', 'phone', 'social'],
    mode: 'patterns-only',
  });

  // A detection can carry a combined target when two detectors agree on a box,
  // so match on containment rather than equality.
  const targets = result.detections.map((d) => d.target).join(' ');
  assert.match(targets, /email/, 'email not detected');
  assert.match(targets, /phone/, 'phone not detected');

  // The fixture links the word "Portfolio" to a LinkedIn profile. Under the
  // default policy that word stays readable, because the link is dead and
  // "Portfolio" identifies nobody.
  assert.equal(
    result.detections.filter((d) => d.text?.includes('linkedin')).length,
    0,
    'anchor text was redacted under the default link policy',
  );
});

test('a date range in the experience section is not mistaken for a phone number', async () => {
  const { bytes } = await buildSampleCv();
  const result = await redact(bytes, { targets: ['phone'], mode: 'patterns-only' });

  for (const detection of result.detections) {
    assert.doesNotMatch(
      detection.text ?? '',
      /2019|2024|840|190/,
      `redacted "${detection.text}", which is CV content, not a phone number`,
    );
  }
  assert.equal(result.detections.length, 1);
});

test('the name is located from an LLM quote and painted black', async () => {
  const { bytes, layout } = await buildSampleCv();
  const provider = scriptedProvider([
    {
      redactions: [
        { line: 1, quote: 'Priya Raghunathan', target: 'name', confidence: 0.97 },
      ],
    },
  ]);

  const result = await redact(bytes, {
    targets: ['name'],
    mode: 'text',
    provider,
    dpi: DPI,
    output: 'both',
    // Explicit, because the default is 'blur' and this test is about where the
    // box landed rather than about which style painted it.
    style: 'box',
  });

  const name = result.detections.find((d) => d.target === 'name');
  assert.ok(name, 'the name was not detected');
  assert.equal(name.source, 'llm-text');

  // The box must land on the name, which the fixture drew at a known point.
  const scale = DPI / POINTS_PER_INCH;
  const expectedX = layout.name.x * scale;
  const expectedY = (layout.pageHeight - layout.name.y - layout.name.size) * scale;
  assert.ok(
    Math.abs(name.box.x - expectedX) < 12,
    `box x ${name.box.x} is not near the name at ${expectedX}`,
  );
  assert.ok(
    Math.abs(name.box.y - expectedY) < 16,
    `box y ${name.box.y} is not near the name at ${expectedY}`,
  );

  // And the pixels there must actually be black.
  const centre = await samplePixel(result.images![0]!, name.box.x + name.box.width / 2, name.box.y + name.box.height / 2);
  assert.deepEqual(centre, [0, 0, 0], `expected black at the name, got ${centre.join(',')}`);
});

test('the default style is blur, and it says so in the warnings', async () => {
  const { bytes } = await buildSampleCv();
  const quote = { line: 1, quote: 'Priya Raghunathan', target: 'name', confidence: 0.97 };

  const run = (style?: 'blur' | 'box') =>
    redact(bytes, {
      targets: ['name'],
      mode: 'text',
      provider: scriptedProvider([{ redactions: [quote] }]),
      dpi: DPI,
      output: 'images',
      ...(style ? { style } : {}),
    });

  const [defaulted, blurred, boxed] = await Promise.all([run(), run('blur'), run('box')]);

  assert.deepEqual(
    defaulted.images![0],
    blurred.images![0],
    'the default did not paint the same pixels as style "blur"',
  );
  assert.notDeepEqual(
    defaulted.images![0],
    boxed.images![0],
    'the default painted the same pixels as style "box"',
  );

  // A shape-leaking style must never be applied silently, default or not.
  assert.equal(
    defaulted.audit.warnings.filter((w) => w.includes('style "blur"')).length,
    1,
    `expected one style warning, got ${JSON.stringify(defaulted.audit.warnings)}`,
  );
  assert.equal(boxed.audit.warnings.length, 0, 'style "box" should warn about nothing');
});

test('the redacted PDF has no extractable text and no metadata', async () => {
  const { bytes } = await buildSampleCv();
  const provider = scriptedProvider([
    { redactions: [{ line: 1, quote: 'Priya Raghunathan', target: 'name', confidence: 0.95 }] },
  ]);

  const result = await redact(bytes, {
    targets: ['name', 'email', 'phone', 'social'],
    mode: 'text',
    provider,
  });

  const doc = await getDocument({ data: new Uint8Array(result.pdf!), isEvalSupported: false })
    .promise;
  try {
    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    assert.equal(
      content.items.length,
      0,
      'the output still contains selectable text, so nothing was truly redacted',
    );

    const metadata = await doc.getMetadata();
    const info = metadata.info as Record<string, string>;
    assert.equal(info.Author ?? '', '', 'the author metadata still names the candidate');
    assert.equal(info.Title ?? '', '', 'the title metadata still names the candidate');
  } finally {
    await doc.destroy();
  }
});

test('vision mode maps grid cells to the words inside them', async () => {
  const { bytes } = await buildSampleCv();
  // C2:H3 on a 24x36 grid covers the header band where the name sits.
  const provider = scriptedProvider([
    { redactions: [{ target: 'name', from: 'C2', to: 'H3', confidence: 0.9 }] },
  ]);

  const result = await redact(bytes, {
    targets: ['name'],
    mode: 'vision',
    provider,
    dpi: DPI,
  });

  assert.ok(result.detections.length > 0, 'no detections came back from vision mode');
  const detection = result.detections[0]!;
  assert.equal(detection.source, 'llm-vision');
  // Snapping means the box hugs the words, not the whole 6x2 cell block.
  const cellBlockHeight = 2 * ((842 * DPI) / POINTS_PER_INCH / 36);
  assert.ok(
    detection.box.height < cellBlockHeight,
    `box height ${detection.box.height} was not snapped below the cell height ${cellBlockHeight}`,
  );
  assert.match(detection.text ?? '', /Priya/);
});

test('an unlocatable quote is reported instead of silently dropped', async () => {
  const { bytes } = await buildSampleCv();
  const provider = scriptedProvider([
    { redactions: [{ line: 1, quote: 'Someone Not On This Page', target: 'name', confidence: 1 }] },
  ]);

  const result = await redact(bytes, { targets: ['name'], mode: 'text', provider });
  assert.equal(result.detections.length, 0);
  assert.ok(
    result.audit.warnings.some((w) => w.includes('could not locate quote')),
    `expected a warning about the missing quote, got ${JSON.stringify(result.audit.warnings)}`,
  );
});

test('a bad input is rejected with a useful message', async () => {
  await assert.rejects(
    () => redact(Buffer.from('this is a docx, honest'), { targets: ['name'] }),
    /not a PDF, PNG, JPEG, or WebP/,
  );
});

async function samplePixel(png: Buffer, x: number, y: number): Promise<number[]> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return [data[0]!, data[1]!, data[2]!];
}

test('a link is dead but its text stays readable by default', async () => {
  const { bytes } = await buildSampleCv({
    extraLine: 'CloudSEK',
    extraLinkUrl: 'https://cloudsek.com/',
  });
  const result = await redact(bytes, { targets: ['name', 'email'], mode: 'patterns-only' });

  assert.equal(
    result.detections.filter((d) => d.text?.includes('cloudsek')).length,
    0,
    'an employer name was blacked out just for being a link',
  );

  // Dead is not optional: the annotation must be gone from the output.
  const doc = await getDocument({ data: new Uint8Array(result.pdf!), isEvalSupported: false })
    .promise;
  try {
    const annotations = await (await doc.getPage(1)).getAnnotations({ intent: 'display' });
    assert.equal(annotations.length, 0, 'a clickable annotation survived');
  } finally {
    await doc.destroy();
  }
});

test('linkText: "redact-all" hides the text of every link', async () => {
  const { bytes } = await buildSampleCv({
    extraLine: 'CloudSEK',
    extraLinkUrl: 'https://cloudsek.com/',
  });
  const result = await redact(bytes, {
    targets: ['name'],
    mode: 'patterns-only',
    linkText: 'redact-all',
  });
  assert.ok(
    result.detections.some((d) => d.text?.includes('cloudsek')),
    'redact-all left a link readable',
  );
});

test('linkText: "redact-identifying" hides a profile link but not an employer link', async () => {
  const identifying = await buildSampleCv({
    extraLine: 'Profile',
    extraLinkUrl: 'https://github.com/someone',
  });
  const employer = await buildSampleCv({
    extraLine: 'CloudSEK',
    extraLinkUrl: 'https://cloudsek.com/',
  });
  const options = {
    targets: ['social'] as const,
    mode: 'patterns-only' as const,
    linkText: 'redact-identifying' as const,
  };

  const a = await redact(identifying.bytes, { ...options, targets: ['social'] });
  assert.ok(
    a.detections.some((d) => d.text === 'https://github.com/someone'),
    'a profile link was left readable',
  );

  const b = await redact(employer.bytes, { ...options, targets: ['social'] });
  assert.equal(
    b.detections.filter((d) => d.text === 'https://cloudsek.com/').length,
    0,
    'an employer link was hidden under redact-identifying',
  );
});

test('the url target redacts a URL written as visible text', async () => {
  const { bytes } = await buildSampleCv({ extraLine: 'github.com/priya-r and ghstmail.space' });
  const result = await redact(bytes, { targets: ['url'], mode: 'patterns-only' });

  const texts = result.detections.map((d) => d.text ?? '').join(' ');
  assert.match(texts, /github\.com\/priya-r/, 'a bare domain with a path was missed');
  assert.match(texts, /ghstmail\.space/, 'a bare domain with a known TLD was missed');
});

test('technology names that look like domains are not redacted', async () => {
  const { bytes } = await buildSampleCv({
    extraLine: 'Node.js Next.js main.py docker-compose.yml 8.95 e.g.',
  });
  const result = await redact(bytes, { targets: ['url'], mode: 'patterns-only' });

  for (const detection of result.detections) {
    assert.doesNotMatch(
      detection.text ?? '',
      /Node\.js|Next\.js|main\.py|compose\.yml|8\.95/,
      `redacted "${detection.text}", which is CV content, not a URL`,
    );
  }
});

test('digits inside a URL are not mistaken for a phone number', async () => {
  const { bytes } = await buildSampleCv({
    extraLine:
      'See linkedin.com/posts/activity-7405463989889175552-GXfn and credly.com/badges/4f7b0158-cf69-421b-8b60-691381eb1167',
  });
  const result = await redact(bytes, {
    targets: ['phone'],
    mode: 'patterns-only',
  });

  for (const detection of result.detections) {
    assert.doesNotMatch(
      detection.text ?? '',
      /7405463989889175552|691381eb1167|4f7b0158/,
      `labelled "${detection.text}" a phone number, but it is part of a URL`,
    );
  }
});

