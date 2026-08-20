import { RedactError } from './errors.js';

/**
 * Fetches the document as markdown from rsparse (our Tika-compatible parser).
 *
 * This is context, not coordinates. Redaction needs to know where on the page a
 * string sits, and rsparse returns text, so the boxes always come from the
 * rendered page. What rsparse adds is a clean, link-preserving view of the whole
 * document in a couple of milliseconds, which helps the model recognise
 * identifiers that are split across pages or hidden behind anchor text.
 */
export async function fetchRsparseMarkdown(
  baseUrl: string,
  data: Buffer,
  contentType: string,
): Promise<string> {
  const url = new URL('/tika', baseUrl).toString();
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, Accept: 'text/plain' },
    body: new Uint8Array(data),
  });

  if (response.status === 422) {
    // rsparse says this explicitly for scanned PDFs, which is the case OCR
    // already handles, so it is not an error here.
    throw new RedactError(await response.text(), 'RSPARSE_NO_TEXT');
  }
  if (!response.ok) {
    throw new RedactError(
      `rsparse returned ${response.status}: ${await response.text()}`,
      'RSPARSE_FAILED',
    );
  }
  return response.text();
}
