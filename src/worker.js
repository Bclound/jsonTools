import { parseDocument, formatDocument, compactDocument, treeRows, compareInputDocuments } from './core.js';
import { sortedFormat, toTypeScript, toZod, toCsv, toYaml, toEnv, mockDocument, tableData, queryPath, unescapeJson, repairText } from './tools-core.js';
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
    } else if (operation === 'repair') {
      const fixed = repairText(text);
      if (fixed.steps.length) fixed.text = formatDocument(parseDocument(fixed.text), options.indent);
      result = fixed;
    } else {
      const doc = documents.get(side);
      if (!doc) throw new Error('请先输入有效的 JSON');
      if (operation === 'format') result = options.sortKeys ? sortedFormat(doc, options.indent) : formatDocument(doc, options.indent);
      else if (operation === 'generate') {
        const { kind, count, indent } = options;
        result = kind === 'ts' ? toTypeScript(doc.root) : kind === 'zod' ? toZod(doc.root) : kind === 'csv' ? toCsv(doc.root, doc.text)
          : kind === 'yaml' ? toYaml(doc.root, doc.text) : kind === 'env' ? toEnv(doc.root, doc.text) : mockDocument(doc, count, indent);
      } else if (operation === 'jsonpath') result = queryPath(doc, options.query);
      else if (operation === 'table') {
        const { columns, rows, source } = tableData(doc.root, doc.text);
        result = { columns, source, rows: rows.slice(0, 5000), total: rows.length };
      } else if (operation === 'unescape') {
        const { text: out, count } = unescapeJson(doc.text);
        result = { count, text: count ? formatDocument(parseDocument(out), options.indent) : out };
      } else if (operation === 'escape') result = JSON.stringify(compactDocument(doc));
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
