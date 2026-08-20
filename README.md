<img src="assets/logo.svg" width="96" alt="rsredact">

# rsredact

Resume redaction for blind hiring. A TypeScript SDK that finds personal identifiers on a CV and removes them, rather than covering them up.

It exists because drawing a black rectangle on a PDF redacts nothing. The text stays underneath, selectable and copy-pasteable, and so do the hyperlinks. We needed something our services could call that produces a file you can safely hand to a hiring manager.

[![ci](https://github.com/RemoteStar-AI/rsredact/actions/workflows/ci.yml/badge.svg)](https://github.com/RemoteStar-AI/rsredact/actions/workflows/ci.yml)

## Quick start

```
npm install @remotestar/rsredact openai
```

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { redact } from '@remotestar/rsredact';
import { openaiProvider } from '@remotestar/rsredact/providers';

const result = await redact(await readFile('cv.pdf'), {
  targets: ['name', 'email', 'phone', 'social', 'photo'],
  provider: openaiProvider(),
});

await writeFile('cv.redacted.pdf', result.pdf);
console.log(result.detections);  // every box, with what it was and where it came from
console.log(result.audit);       // targets, provider, llmCalls, warnings, durationMs
```

Accepts PDF, PNG, JPEG, and WebP. Returns a PDF, page images, or both.

## What "redacted" means here

Three things, because each one is a way redaction usually fails.

**The text is gone, not hidden.** Pages are rendered to pixels, the boxes are painted, and the PDF is rebuilt from those images. Nothing survives but the pixels you can see. `getTextContent()` on the output returns zero items.

**Every link is dead, and that is not an option.** No annotation survives into the output, so nothing is clickable and no URL is recoverable, in every mode and for every setting. Whether the *visible text* of a link is also hidden is a separate question, and the answer is usually no. See below.

**The metadata is cleared.** A CV PDF very often carries the candidate's name in its Author field and their filename in Title. Both are emptied.

What that costs you: the output is raster, so it is larger than the input (409 KB against 109 KB on a one page resume) and no longer searchable. That is the trade, and it is not negotiable if the goal is that nobody can recover the name.

## Dead links and hidden links are different things

These are two separate axes, and conflating them was the first thing we got wrong.

**Dead** means the link no longer goes anywhere. That is unconditional. The output is rebuilt from rendered pages, so link annotations, form fields, and embedded actions do not exist in it. There is no option to turn this off and no mode in which a link survives.

**Hidden** means the reader cannot even read the words that used to be a link. That is a content decision, not a security one, and it defaults to off.

The reason is that hiding link text mostly destroys information for no privacy gain. A CV links an employer's name to the employer's site, a certification like "CKA" to its badge, and a project title to its repository. Once the link is dead, the destination is gone; what is left on the page is the word "CloudSEK" or "CKA", which identifies nobody. Blacking those out costs the reviewer real signal and buys nothing.

| `linkText` | Link is dead | Link text readable | Use when |
|---|---|---|---|
| `keep` (default) | yes | yes | Normal blind hiring. Employer names, certifications, and project titles stay readable. |
| `redact-identifying` | yes | hidden when its destination matches a requested target, readable otherwise | You want a link reading `github.com/someone` gone but an employer's site left alone. |
| `redact-all` | yes | no | The output must show no trace that a link was ever there. |

Separately from all of this, a URL written out as **visible text** is identifying content in its own right, because a reader can simply type it. That is handled by the `url` target (any URL) and the `social` target (known profile hosts), not by `linkText`. Ask for `url` and `github.com/someone` written in the body gets redacted whether or not anything linked to it.

## Targets

Pass the ones you want. Strings resolve against the built-in list:

| Target | What it covers |
|---|---|
| `name` | The candidate's own name, wherever it appears |
| `email` | Email addresses |
| `phone` | Telephone and mobile numbers, with their labels |
| `address` | Postal or residential address, not employer locations |
| `social` | LinkedIn, GitHub, X, portfolios, link aggregators |
| `url` | Any URL |
| `photo` | A photograph of the candidate, not logos or charts |
| `signature` | A handwritten signature |
| `dob` | Date of birth or age |
| `nationality` | Nationality, citizenship, visa status |
| `gender` | Gender, sex, or pronouns |
| `marital_status` | Marital status, spouse, dependents |
| `employer` | Company names, keeping titles and dates |
| `school` | Institution names, keeping degrees and dates |
| `reference` | Referees and their contact details |

`photo` and `signature` are visual: only a model looking at the page can find them.

Define your own by passing an object instead of a string. The description is the whole instruction, so be specific:

```ts
targets: ['name', { id: 'clearance', description: 'Security clearance level or ID' }]
```

Add `patterns: [/.../ ]` and the regexes run before any model call. Add `visualOnly: true` and it is looked for on the page rather than in the text.

## Options

| Option | Default | Purpose |
|---|---|---|
| `targets` | required | What to look for |
| `provider` | none | Omit to run pattern and link detection only |
| `mode` | `auto` | `auto`, `text`, `vision`, `patterns-only` |
| `linkText` | `keep` | `keep`, `redact-identifying`, `redact-all` |
| `style` | `box` | `box`, `label`, `blur`, `pixelate` |
| `dpi` | `150` | Render resolution |
| `padding` | `2` | Pixels added around every box |
| `minConfidence` | `0.5` | Drop detections below this |
| `grid` | `24x36` | Grid size for vision mode |
| `ocr` | `true` | OCR pages with no text layer, needs `tesseract.js` |
| `output` | `pdf` | `pdf`, `images`, `both` |
| `rsparseUrl` | none | An [rsparse](https://github.com/RemoteStar-AI/rsparse) instance, for document context |
| `onProgress` | none | Per stage callback |

`blur` and `pixelate` look like redaction but are not: blurred text can often be recovered. Both emit a warning in `audit.warnings` saying so. Use `box` for anything that leaves your control.

## Providers

A provider is transport plus "give me back parsed JSON". rsredact owns all the prompting, so a new backend is about forty lines.

```ts
import { openaiProvider, anthropicProvider, customProvider } from '@remotestar/rsredact/providers';

openaiProvider({ model: 'gpt-4.1' })            // also Azure, OpenRouter, vLLM, Ollama via baseUrl
anthropicProvider({ model: 'claude-opus-5' })

customProvider({
  name: 'internal-gateway',
  supportsVision: true,
  generate: async (request) => callYourThing(request),
});
```

`openai` and `@anthropic-ai/sdk` are optional peer dependencies, loaded only when used. Install just the one you need.

For OpenAI, schemas are rewritten to the strict structured-outputs subset on the way out, so a custom target's schema cannot break the request.

There is also `scriptedProvider([...])`, which replays canned responses. It is how the test suite runs the whole pipeline without a network call.

## How it finds things

Four layers, cheapest first. Each one only handles what the layer below cannot.

**Coordinates come from the document, never from the model.** A text PDF already carries exact glyph boxes, so those are read directly. A scanned page goes through OCR instead, which gives word boxes.

**Regexes catch the mechanical identifiers.** Emails, phones, URLs, known profile hosts. No model call, no hallucination, no cost. Guards then throw out the false positives that matter: a phone pattern will happily eat `2019 - 2024` out of an experience section, and blacking out every date range makes a CV useless.

**The model reads text, not pixels.** It gets the page line by line and returns the substrings to redact, which are then mapped back to the words that produced them. The model only ever has to recognise an identifier, never place one, which is the part models are worst at.

**Vision handles what text cannot.** You cannot OCR a face, and blind hiring needs the headshot gone. For `photo` and `signature`, and for pages with no readable text, the page is sent with a reference grid drawn over it and the model names two corner cells, like `C4` to `H6`. Where words are known, that rectangle is then snapped down to the words inside it, so a coarse cell becomes a tight box.

### Why the grid is the fallback and not the plan

A grid is the obvious way to ask a model where something is, and it is worse than it looks. At 24x36 on A4 a single cell is still about two lines of body text tall. Ask for a name and the cell you get back also holds the job title. Precise localisation is also the weakest thing a vision model does. So the grid earns its place on exactly the two jobs nothing else can do, photos and unreadable pages, and text handles the rest with the document's own coordinates.

### Hyperlinks

PDFs keep hyperlinks in an annotation layer beside the text, not in it. Text extractors read the text and leave the annotations behind, which is why most PDF-to-text tools lose your URLs. It is also a leak: a CV that renders the word "Portfolio" over `https://janesmith.com` gives away the candidate in a layer that text extraction never sees.

rsredact reads the annotations for their rects, which arrive in the same coordinate space as the text. Rebuilding the output from rendered pages is what kills them.

It also shows the model each link as `visible text -> destination`. That is not so the model can hide anything that happens to be a link, which was our first mistake here. It is so a bare label standing in for the candidate's own page, something like "Portfolio" or "Profile", can be judged on where it goes rather than on how it reads, while an employer name or a certification linking somewhere useful is left alone.

## Numbers

One page LaTeX resume, Apple M-series, 12 runs.

Pattern and link detection only, no model call:

| dpi | mean | p50 | p95 |
|---|---|---|---|
| 110 | 235 ms | 209 | 349 |
| 150 | 291 ms | 272 | 369 |
| 200 | 429 ms | 426 | 462 |

Most of that is rasterizing the page, so it scales with dpi and page count rather than with how much text there is.

With a model in the loop, expect the model to dominate. A full run on the same file with `gpt-4.1` and targets `name, email, phone, social, address, photo` takes about 4.6 s and makes 2 calls, one for text and one for the photo.

## Limitations

**DOCX and other office formats are rejected.** Their text reflows, so it has no fixed coordinates to redact. Convert to PDF first. rsparse will tell you what a document says, but not where on a page it says it.

**OCR is optional and untested in CI.** `tesseract.js` is a peer dependency, loaded only for pages with no text layer. If it is not installed, those pages fall through to vision detection and a warning is recorded rather than the run failing.

**Word boxes on text PDFs are measured, not exact.** pdf.js reports the width of a whole text run but not where each character sits inside it, so characters are placed using measured advance widths from a proxy font of the same class, scaled to the run's real width. The error is a fraction of a character, which the default 2 px padding covers. Splitting the width evenly instead, which is the obvious approach, drifts by a full character by mid-line and leaves the first letter of an email address showing.

**Employer and school redaction is coarse.** Both are aggressive by nature: enough context usually survives elsewhere in the CV that a determined reader can guess. Treat them as reducing bias, not as anonymity.

## Development

```
npm install
npm test        # builds, then runs the suite against dist
npm run typecheck
```

The tests generate their own fixture CV, including a hyperlink whose anchor text hides the URL, and assert on both the detections and the pixels. No network and no API key needed.

## License

MIT
