/**
 * Redacts one file and writes the result next to it.
 *
 *   OPENAI_API_KEY=... npx tsx examples/redact.ts cv.pdf
 *
 * Drop the provider argument and only pattern and link detection runs, which
 * needs no API key and still removes emails, phone numbers, and every link.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { redact } from '../src/index.js';
import { openaiProvider } from '../src/providers/index.js';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('usage: redact.ts <cv.pdf>');
  process.exit(1);
}

const outputPath = `${inputPath.replace(/\.[^.]+$/, '')}.redacted.pdf`;

const result = await redact(await readFile(inputPath), {
  targets: ['name', 'email', 'phone', 'social', 'address', 'photo'],
  provider: process.env.OPENAI_API_KEY ? openaiProvider() : undefined,
  onProgress: (event) => process.stderr.write(`  ${event.stage}\n`),
});

await writeFile(outputPath, result.pdf!);

for (const detection of result.detections) {
  console.log(
    `p${detection.page + 1} ${detection.target.padEnd(10)} ${detection.source.padEnd(10)} ${detection.text ?? '(visual)'}`,
  );
}
for (const warning of result.audit.warnings) {
  console.warn(`warning: ${warning}`);
}
console.log(
  `\n${result.detections.length} redactions across ${result.audit.pages} page(s) in ${result.audit.durationMs}ms -> ${outputPath}`,
);
