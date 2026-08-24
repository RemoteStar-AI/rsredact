/** A rectangle in raster page space: pixels, origin top-left. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One word (or word-fragment) with its position on the rendered page. */
export interface Word {
  /** Stable id used when asking an LLM which words to redact. */
  id: string;
  text: string;
  box: Box;
  page: number;
  /** Index of the visual line this word belongs to, per page. */
  line: number;
}

/** A hyperlink annotation: the URL and the rectangle you click. */
export interface PageLink {
  url: string;
  box: Box;
}

export interface Page {
  index: number;
  /** Raster dimensions in pixels at the configured dpi. */
  width: number;
  height: number;
  /** PNG bytes of the rendered page. */
  image: Buffer;
  /** Empty when the source had no text layer and OCR was not run. */
  words: Word[];
  /** Where the words came from. */
  textSource: 'pdf-text-layer' | 'ocr' | 'none';
  /**
   * Link annotations. A CV that renders "Portfolio" over
   * https://janesmith.com leaks the candidate's name in a layer that text
   * extraction never sees, so links are collected separately.
   */
  links: PageLink[];
}

export interface LoadedDocument {
  pages: Page[];
  /** Non-fatal problems hit while reading the file. */
  warnings: string[];
  /** Original PDF page sizes in PDF points, when the input was a PDF. */
  pointSizes?: { width: number; height: number }[];
  kind: 'pdf' | 'image';
  dpi: number;
}

/** Built-in things RS Redact knows how to look for. */
export type BuiltinTarget =
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'social'
  | 'url'
  | 'photo'
  | 'dob'
  | 'nationality'
  | 'gender'
  | 'marital_status'
  | 'signature'
  | 'employer'
  | 'school'
  | 'reference';

export type TargetId = BuiltinTarget | (string & {});

/**
 * A thing to redact. Strings resolve against the built-in registry; pass an
 * object to define a custom target for the LLM to look for.
 */
export type TargetInput = TargetId | CustomTarget;

export interface CustomTarget {
  id: string;
  /** Told to the LLM verbatim. Be specific: this is the whole instruction. */
  description: string;
  /** Optional regexes applied before any LLM call. */
  patterns?: RegExp[];
  /** Only findable by looking at the page, not the text (photos, signatures). */
  visualOnly?: boolean;
}

export interface ResolvedTarget extends CustomTarget {
  patterns: RegExp[];
  visualOnly: boolean;
}

export type DetectionSource = 'pattern' | 'link' | 'llm-text' | 'llm-vision' | 'manual';

export interface Detection {
  page: number;
  target: string;
  box: Box;
  /** The matched text, when the detection came from text. */
  text?: string;
  /** 0..1. Pattern matches are 1. */
  confidence: number;
  source: DetectionSource;
  /** Word ids that produced this box, for auditing. */
  wordIds?: string[];
}

export type RedactionStyle = 'box' | 'label' | 'blur' | 'pixelate';

export interface RedactOptions {
  /**
   * Refuse a document with more pages than this before any of it is rasterised.
   * Rendering is the expensive step, so the caller's page limit belongs here rather
   * than in a check after the fact.
   */
  maxPages?: number;
  targets: TargetInput[];
  /** Omit to run pattern-only detection. */
  provider?: LLMProvider;
  /**
   * text  – LLM reads the extracted words, returns word ids (precise, cheap)
   * vision – LLM reads a grid-overlaid page image, returns grid cells
   * auto  – text when a text layer exists, plus vision when visual targets are
   *         requested or when a page has no text at all. Default.
   */
  mode?: 'auto' | 'text' | 'vision' | 'patterns-only';
  /** Render resolution. Higher is sharper and slower. Default 150. */
  dpi?: number;
  /** Grid used by vision mode. */
  grid?: GridOptions;
  /**
   * How a detected region is covered. Default 'blur'.
   *
   * Every style destroys the text, because the page is rebuilt from pixels
   * either way. They differ in what they still tell a reader about what was
   * removed: 'blur' and 'pixelate' leave the shape of it visible, which is
   * enough to tell a short name from a long one. 'box' leaves nothing.
   */
  style?: RedactionStyle;
  /** Padding in pixels added around every detected box. Default 2. */
  padding?: number;
  /** Drop detections below this confidence. Default 0.5. */
  minConfidence?: number;
  /**
   * Whether the *visible text* of a hyperlink is painted over.
   *
   * Every hyperlink is dead in every mode. That is not configurable: the output
   * is rebuilt from rendered pages, so no annotation survives and nothing is
   * clickable. This option is only about whether the reader can still read the
   * words that used to be a link.
   *
   * 'keep' (default) leaves link text readable. A dead link's destination is
   * already gone, and the visible words are usually content worth keeping: an
   * employer name, a certification like "CKA", a project title.
   * 'redact-identifying' also hides link text whose destination matches a
   * requested target, so a link reading "github.com/someone" goes but an
   * employer's site stays.
   * 'redact-all' hides the visible text of every link. Use it when the output
   * must show no trace that a link was ever there.
   *
   * Independently of this, a URL written out as visible text is identifying
   * content, and is redacted whenever the 'url' or 'social' target is requested.
   */
  linkText?: 'keep' | 'redact-identifying' | 'redact-all';
  /** Run OCR when a page has no text layer. Requires tesseract.js. Default true. */
  ocr?: boolean;
  /** Language passed to tesseract. Default 'eng'. */
  ocrLanguage?: string;
  /** What to write out. Default 'pdf'. */
  output?: 'pdf' | 'images' | 'both';
  /**
   * Base URL of an rsparse instance, e.g. http://localhost:9998. When set, the
   * original file is also parsed to markdown and handed to the LLM as
   * document-level context. Optional: the pipeline works without it, and
   * coordinates always come from the rendered page, never from rsparse.
   */
  rsparseUrl?: string;
  /** Called after each stage; useful for long documents. */
  onProgress?: (event: ProgressEvent) => void;
}

export interface GridOptions {
  /** Number of columns, labelled A, B, C... Default 24. */
  cols?: number;
  /** Number of rows, labelled 1, 2, 3... Default 36. */
  rows?: number;
  /** 0..1 opacity of the grid lines. Default 0.35. */
  opacity?: number;
  /**
   * Snap LLM cell regions down to the words inside them, when words are known.
   * Turns a coarse cell into a tight box. Default true.
   */
  snapToWords?: boolean;
}

export interface ProgressEvent {
  stage:
    | 'load'
    | 'ocr'
    | 'parse-context'
    | 'detect-patterns'
    | 'detect-text'
    | 'detect-vision'
    | 'apply';
  page?: number;
  totalPages?: number;
  message?: string;
}

export interface RedactResult {
  /** Redacted PDF bytes. Present unless output was 'images'. */
  pdf?: Buffer;
  /** Redacted page PNGs. Present when output was 'images' or 'both'. */
  images?: Buffer[];
  /** Everything that was found and painted over. */
  detections: Detection[];
  audit: AuditRecord;
}

export interface AuditRecord {
  targets: string[];
  mode: string;
  /** Which link-text policy was applied. Links are always dead. */
  linkText: string;
  provider?: string;
  pages: number;
  dpi: number;
  textSources: string[];
  detectionCounts: Record<string, number>;
  llmCalls: number;
  durationMs: number;
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Provider contract
 * ------------------------------------------------------------------ */

export interface ProviderImage {
  mediaType: 'image/png' | 'image/jpeg';
  /** base64, no data: prefix */
  data: string;
}

export interface ProviderRequest {
  system: string;
  prompt: string;
  images?: ProviderImage[];
  /** JSON Schema the reply must satisfy. */
  schema: {
    name: string;
    description: string;
    schema: Record<string, unknown>;
  };
  maxTokens: number;
}

/**
 * The only thing a backend has to implement. RS Redact owns all prompting;
 * a provider is transport plus "give me back parsed JSON".
 */
export interface LLMProvider {
  readonly name: string;
  readonly supportsVision: boolean;
  generateJson<T>(request: ProviderRequest): Promise<T>;
}
