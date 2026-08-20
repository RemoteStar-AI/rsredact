import type { Box, Detection } from '../types.js';

/**
 * The same identifier is often found twice: once by a regex and once by the
 * model. Painting it twice is harmless but makes the audit record misleading,
 * so overlapping boxes for the same region collapse into one.
 */
export function mergeDetections(detections: Detection[], minConfidence: number): Detection[] {
  const kept = detections.filter(
    (d) => d.confidence >= minConfidence && d.box.width > 0.5 && d.box.height > 0.5,
  );

  const byPage = new Map<number, Detection[]>();
  for (const detection of kept) {
    const bucket = byPage.get(detection.page);
    if (bucket) bucket.push(detection);
    else byPage.set(detection.page, [detection]);
  }

  const out: Detection[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const items = byPage
      .get(page)!
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const merged: Detection[] = [];

    for (const item of items) {
      const host = merged.find((candidate) => shouldMerge(candidate.box, item.box));
      if (!host) {
        merged.push({ ...item });
        continue;
      }
      host.box = union(host.box, item.box);
      host.confidence = Math.max(host.confidence, item.confidence);
      if (host.target !== item.target) host.target = mergeTargets(host.target, item.target);
      // A pattern match is the stronger provenance: keep it in the record.
      if (item.source === 'pattern') host.source = 'pattern';
      host.wordIds = dedupe([...(host.wordIds ?? []), ...(item.wordIds ?? [])]);
      if (item.text && !host.text?.includes(item.text)) {
        host.text = host.text ? `${host.text} | ${item.text}` : item.text;
      }
    }
    out.push(...merged);
  }
  return out;
}

/** Grow every box by `padding` pixels, clamped to the page. */
export function padDetections(
  detections: Detection[],
  padding: number,
  pageSizes: { width: number; height: number }[],
): Detection[] {
  if (padding <= 0) return detections;
  return detections.map((detection) => {
    const size = pageSizes[detection.page];
    const x = Math.max(0, detection.box.x - padding);
    const y = Math.max(0, detection.box.y - padding);
    const right = detection.box.x + detection.box.width + padding;
    const bottom = detection.box.y + detection.box.height + padding;
    return {
      ...detection,
      box: {
        x,
        y,
        width: (size ? Math.min(right, size.width) : right) - x,
        height: (size ? Math.min(bottom, size.height) : bottom) - y,
      },
    };
  });
}

function shouldMerge(a: Box, b: Box): boolean {
  return contains(a, b) || contains(b, a) || iou(a, b) > 0.5;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

function iou(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const overlap = width * height;
  return overlap / (a.width * a.height + b.width * b.height - overlap);
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function mergeTargets(a: string, b: string): string {
  const parts = dedupe([...a.split('+'), ...b.split('+')]).sort();
  return parts.join('+');
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
