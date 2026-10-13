import { parseDocument, formatDocument, compactDocument, treeRows, compareInputDocuments } from './core.js';
import { findFocus, searchDocument, graphDocument } from './explore-core.js';

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
    } else if (operation === 'compare-input') {
      result = compareInputDocuments(options.left, options.right, options, documents);
    } else {
      const doc = documents.get(side);
      if (!doc) throw new Error('请先输入有效的 JSON');
      if (operation === 'format') result = formatDocument(doc, options.indent);
      else if (operation === 'compact') result = compactDocument(doc);
      else if (operation === 'tree') result = treeRows(doc, options.expanded, options.query);
      else if (operation === 'focus') result = findFocus(doc, options.position);
      else if (operation === 'search') result = searchDocument(doc, options.query);
      else if (operation === 'graph') result = graphDocument(doc, options);
      else throw new Error('未知操作');
    }
    self.postMessage({ id, result, elapsed: performance.now() - start });
  } catch (error) {
    self.postMessage({ id, error: { message: error.message, offset: error.offset, line: error.line, column: error.column }, elapsed: performance.now() - start });
  }
};
