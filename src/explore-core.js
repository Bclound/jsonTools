import { pathFor, preview } from './core.js';

function indexDocument(doc) {
  if (doc.exploreIndex) return doc.exploreIndex;
  const entries = [], lines = [0];
  for (let i = 0; i < doc.text.length; i++) if (doc.text[i] === '\n') lines.push(i + 1);
  const stack = [{ node: doc.root, key: '$', path: '$', parent: -1, start: doc.root.offset }];
  while (stack.length) {
    const item = stack.pop(), id = entries.length;
    const entry = { ...item, id, end: item.node.offset + item.node.length, children: [] };
    entries.push(entry);
    if (item.parent >= 0) entries[item.parent].children.push(id);
    const children = item.node.children || [];
    if (item.node.type !== 'object' && item.node.type !== 'array') continue;
    for (let i = children.length - 1; i >= 0; i--) {
      const property = children[i];
      const node = item.node.type === 'object' ? property.children[1] : property;
      const key = item.node.type === 'object' ? property.children[0].value : i;
      stack.push({ node, key, path: pathFor(item.path, key), parent: id, start: property.offset });
    }
  }
  return doc.exploreIndex = { entries, lines };
}

function floorIndex(items, value, read = x => x) {
  let low = 0, high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (read(items[mid]) <= value) low = mid + 1; else high = mid;
  }
  return Math.max(0, low - 1);
}

function describe(doc, entry) {
  const lines = indexDocument(doc).lines;
  const lineIndex = floorIndex(lines, entry.start);
  return { id: entry.id, parent: entry.parent, key: entry.key, path: entry.path,
    type: entry.node.type, value: preview(entry.node, doc.text), count: entry.children.length,
    offset: entry.start, length: entry.end - entry.start,
    valueOffset: entry.node.offset, valueLength: entry.node.length,
    line: lineIndex + 1, column: entry.start - lines[lineIndex] + 1 };
}

export function findFocus(doc, position) {
  const { entries, lines } = indexDocument(doc);
  const pos = Math.max(0, Math.min(position, doc.text.length));
  const index = floorIndex(entries, pos, row => row.start);
  let entry = entries[index];
  const next = entries[index + 1];
  // 在行首缩进处也显示本行字段，空白行仍归属所在容器。
  if (next && next.start > pos && !/[^\t ]/.test(doc.text.slice(pos, next.start))) entry = next;
  const lineStart = lines[floorIndex(lines, pos)];
  // 值末尾、逗号及行尾空白仍归属本行字段；结束括号则回到对应容器。
  while (entry.parent >= 0 && pos >= entry.end) {
    if (!/[}\]]/.test(doc.text[pos] || '') && entry.end > lineStart && !/[^\t ,\r]/.test(doc.text.slice(entry.end, pos))) break;
    entry = entries[entry.parent];
  }
  const container = ['object', 'array'].includes(entry.node.type) ? entry : entries[entry.parent] || entry;
  const ancestors = [];
  for (let parent = entry.parent; parent >= 0; parent = entries[parent].parent) ancestors.push(parent);
  return { ...describe(doc, entry), containerId: container.id, ancestors };
}

export function searchDocument(doc, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const { entries } = indexDocument(doc), rows = [];
  for (const entry of entries) {
    const isValue = !['object', 'array'].includes(entry.node.type);
    const value = isValue ? (entry.node.type === 'string' ? entry.node.value : doc.text.slice(entry.node.offset, entry.end)) : '';
    const match = String(entry.key).toLocaleLowerCase().includes(needle) ? '字段'
      : isValue && value.toLocaleLowerCase().includes(needle) ? '值'
      : entry.path.toLocaleLowerCase() === needle ? '路径' : '';
    if (!match) continue;
    const row = describe(doc, entry);
    if (match === '值' && value.length > 160) {
      const at = value.toLocaleLowerCase().indexOf(needle), start = Math.max(0, at - 45);
      row.value = `${start ? '…' : ''}${value.slice(start, start + 160)}${start + 160 < value.length ? '…' : ''}`;
    }
    rows.push({ ...row, match });
  }
  return rows;
}

export function graphDocument(doc, { collapsed = [] } = {}) {
  const { entries } = indexDocument(doc);
  const root = entries[0], closed = new Set(collapsed);
  const cards = [], edges = [], queue = [{ entry: root, depth: 0 }];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { entry, depth } = queue[cursor];
    const rows = entry.children.map(id => describe(doc, entries[id]));
    const card = { ...describe(doc, entry), depth, rows };
    cards.push(card);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      row.expandable = (row.type === 'object' || row.type === 'array') && row.count > 0;
      row.open = row.expandable && !closed.has(row.id);
      if (row.open) {
        edges.push({ from: entry.id, to: row.id, row: rowIndex });
        queue.push({ entry: entries[row.id], depth: depth + 1 });
      }
    }
  }
  return { root: describe(doc, root), cards, edges, total: entries.length };
}
