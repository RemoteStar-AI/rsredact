/**
 * tesseract.js is an optional peer dependency: it is only loaded when a page
 * has no text layer. This declaration keeps the project typechecking when it is
 * not installed. The real shape is narrowed at the call site in document/ocr.ts.
 */
declare module 'tesseract.js' {
  export function createWorker(language?: string): Promise<unknown>;
}
