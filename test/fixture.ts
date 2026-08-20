import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib';

export interface FixtureLayout {
  /** Where the candidate name sits, in PDF points from the bottom-left. */
  name: { x: number; y: number; size: number };
  pageHeight: number;
}

/**
 * A one-page CV with the identifiers a real one has: a name in the header, an
 * email, a phone number, and anchor text whose URL carries the candidate's
 * name in a layer text extraction cannot see.
 */
export interface FixtureOptions {
  /** An extra line of body text, added below the header. */
  extraLine?: string;
  /** When set, the extra line becomes a hyperlink to this URL. */
  extraLinkUrl?: string;
}

export async function buildSampleCv(
  options: FixtureOptions = {},
): Promise<{ bytes: Buffer; layout: FixtureLayout }> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const body = await pdf.embedFont(StandardFonts.Helvetica);

  const name = { x: 60, y: 770, size: 22 };
  page.drawText('Priya Raghunathan', { ...name, font: bold, color: rgb(0, 0, 0) });
  page.drawText('Senior Backend Engineer', {
    x: 60,
    y: 745,
    size: 12,
    font: body,
    color: rgb(0.25, 0.25, 0.25),
  });
  page.drawText('Email: priya.raghunathan@example.com', { x: 60, y: 722, size: 10, font: body });
  page.drawText('Mobile: +91 98765 43210', { x: 60, y: 708, size: 10, font: body });
  page.drawText('Portfolio', { x: 60, y: 694, size: 10, font: body, color: rgb(0, 0, 0.8) });

  page.drawText('EXPERIENCE', { x: 60, y: 650, size: 12, font: bold });
  page.drawText('Staff Engineer, Payments Platform          2019 - 2024', {
    x: 60,
    y: 630,
    size: 10,
    font: body,
  });
  page.drawText('Cut checkout latency from 840ms to 190ms across 12 markets.', {
    x: 60,
    y: 616,
    size: 10,
    font: body,
  });
  page.drawText('Led a team of 6 engineers through a ledger migration.', {
    x: 60,
    y: 602,
    size: 10,
    font: body,
  });

  const annotations = [];
  if (options.extraLine) {
    page.drawText(options.extraLine, { x: 60, y: 578, size: 10, font: body });
    if (options.extraLinkUrl) {
      annotations.push(
        pdf.context.register(
          pdf.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [58, 574, 58 + body.widthOfTextAtSize(options.extraLine, 10) + 2, 590],
            Border: [0, 0, 0],
            A: pdf.context.obj({
              Type: 'Action',
              S: 'URI',
              URI: PDFString.of(options.extraLinkUrl),
            }),
          }),
        ),
      );
    }
  }

  // Anchor text says "Portfolio"; the URL says who the candidate is.
  const annotation = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [58, 690, 105, 706],
    Border: [0, 0, 0],
    A: pdf.context.obj({
      Type: 'Action',
      S: 'URI',
      URI: PDFString.of('https://linkedin.com/in/priya-raghunathan'),
    }),
  });
  annotations.unshift(pdf.context.register(annotation));
  page.node.set(PDFName.of('Annots'), pdf.context.obj(annotations));

  // A real CV PDF usually carries the candidate's name in its metadata too.
  pdf.setTitle('Priya Raghunathan - CV');
  pdf.setAuthor('Priya Raghunathan');

  return {
    bytes: Buffer.from(await pdf.save()),
    layout: { name, pageHeight: 842 },
  };
}
