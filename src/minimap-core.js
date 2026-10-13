const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const MINI_LINE_HEIGHT = 3;

export function minimapWindow(total, first, last, height) {
  total = Math.max(1, total);
  first = clamp(first, 1, total);
  last = clamp(last, first, total);
  const capacity = Math.max(1, Math.min(total, Math.floor(height / MINI_LINE_HEIGHT)));
  const visible = last - first + 1;
  const progress = (first - 1) / Math.max(1, total - visible);
  const start = 1 + Math.round(clamp(progress, 0, 1) * (total - capacity));
  const thumbHeight = Math.min(height, Math.max(18, visible * MINI_LINE_HEIGHT));
  const thumbTop = clamp((first - start) * MINI_LINE_HEIGHT, 0, height - thumbHeight);
  return { start, end: Math.min(total, start + capacity - 1), thumbTop, thumbHeight, visible };
}

export function minimapLineAt(y, model, total) {
  return clamp(model.start + Math.floor(y / MINI_LINE_HEIGHT), 1, Math.min(total, model.end));
}

export function overviewLineAt(y, height, total) {
  return clamp(1 + Math.round(clamp(y / Math.max(1, height - 1), 0, 1) * (total - 1)), 1, total);
}

export function overviewTargetAt(y, height, total, matches) {
  const line = overviewLineAt(y, height, total), index = firstMatchAt(matches, line);
  let target = line, distance = 4;
  for (const candidate of [matches[index - 1], matches[index]]) {
    if (candidate === undefined) continue;
    const candidateY = (candidate - 1) / Math.max(1, total - 1) * Math.max(0, height - 2);
    if (Math.abs(y - candidateY) <= distance) { distance = Math.abs(y - candidateY); target = candidate; }
  }
  return target;
}

export function matchPixels(lines, total, height) {
  const pixels = new Set();
  for (const line of lines) pixels.add(Math.round((line - 1) / Math.max(1, total - 1) * Math.max(0, height - 2)));
  return [...pixels];
}

export function firstMatchAt(lines, line) {
  let low = 0, high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle] < line) low = middle + 1; else high = middle;
  }
  return low;
}
