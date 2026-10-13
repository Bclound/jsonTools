import { parseDocument, formatDocument, compactDocument, treeRows, compareDocuments } from './core.js';

const documents = new Map();
self.onmessage = ({ data }) => {
  const { id, operation, side, text, ...options } = data;
  const start = performance.now();
  try {
    let result;
    if (operation === 'load') {
      documents.delete(side);
      const doc = parseDocument(text);
      documents.set(side, doc);
      result = { rootOffset: doc.root.offset, nodes: doc.nodes, lines: doc.lines, bytes: new TextEncoder().encode(text).length, duplicates: doc.duplicates.length };
    } else if (operation === 'compare') {
      if (!documents.has('left') || !documents.has('right')) throw new Error('请先校验两侧 JSON');
      result = compareDocuments(documents.get('left'), documents.get('right'), options);
    } else {
      const doc = documents.get(side);
      if (!doc) throw new Error('请先输入有效的 JSON');
      if (operation === 'format') result = formatDocument(doc, options.indent);
      else if (operation === 'compact') result = compactDocument(doc);
      else if (operation === 'tree') result = treeRows(doc, options.expanded, options.query);
      else throw new Error('未知操作');
    }
    self.postMessage({ id, result, elapsed: performance.now() - start });
  } catch (error) {
    self.postMessage({ id, error: { message: error.message, offset: error.offset, line: error.line, column: error.column }, elapsed: performance.now() - start });
  }
};
