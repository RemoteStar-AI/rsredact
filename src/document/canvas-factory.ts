import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

export interface CanvasAndContext {
  canvas: Canvas;
  context: SKRSContext2D;
}

/**
 * pdf.js ships a Node canvas factory that depends on the `canvas` package.
 * We use @napi-rs/canvas instead (prebuilt binaries, no node-gyp), so we hand
 * pdf.js this factory via the CanvasFactory option.
 */
export class NapiCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext('2d') };
  }

  reset(canvasAndContext: CanvasAndContext, width: number, height: number): void {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  }

  destroy(canvasAndContext: CanvasAndContext): void {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}
