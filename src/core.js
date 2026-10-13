import { parseTree, format, createScanner, SyntaxKind } from 'jsonc-parser';

const errorMessages = {
  1: '无法识别的字符', 2: '数字格式不正确', 3: '缺少属性名（请使用双引号）',
  4: '缺少值', 5: '缺少冒号', 6: '缺少逗号', 7: '缺少右花括号 }',
  8: '缺少右方括号 ]', 9: 'JSON 结束后存在多余内容', 10: '标准 JSON 不允许注释',
  11: '注释未结束', 12: '字符串未结束', 13: '数字不完整',
  14: 'Unicode 转义不正确', 15: '转义字符不正确', 16: '字符串内存在未转义的控制字符',
};

export function location(text, offset) {
  const before = text.slice(0, offset);
  return { line: (before.match(/\n/g)?.length || 0) + 1, column: offset - before.lastIndexOf('\n') };
}

export function parseDocument(text) {
  if (!text.trim()) throw Object.assign(new Error('请先输入或导入 JSON'), { offset: 0, line: 1, column: 1 });
  // 在递归解析前限制嵌套深度，避免异常输入耗尽调用栈。
  const scanner = createScanner(text, false);
  let depth = 0;
  for (let token; (token = scanner.scan()) !== SyntaxKind.EOF;) {
    if (token === SyntaxKind.OpenBraceToken || token === SyntaxKind.OpenBracketToken) depth++;
    if (token === SyntaxKind.CloseBraceToken || token === SyntaxKind.CloseBracketToken) depth--;
    if (depth > 512) throw new Error('嵌套超过 512 层，请先拆分文档后再处理');
  }
  const errors = [];
  const root = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
  if (errors.length || !root) {
    const error = errors[0] || { offset: 0, error: 4 };
    throw Object.assign(new Error(errorMessages[error.error] || 'JSON 格式不正确'), {
      offset: error.offset, ...location(text, error.offset),
    });
  }
  let nodes = 0;
  const duplicates = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    nodes++;
    if (node.type === 'object') {
      const seen = new Set();
      for (const property of node.children || []) {
        const key = property.children[0].value;
        if (seen.has(key)) duplicates.push({ key, offset: property.offset });
        seen.add(key);
        stack.push(property.children[1]);
      }
    } else if (node.type === 'array') {
      for (const child of node.children || []) stack.push(child);
    }
  }
  return { text, root, nodes, duplicates, lines: (text.match(/\n/g)?.length || 0) + 1 };
}

export function formatDocument(doc, indent = 2) {
  const edits = format(doc.text, undefined, { insertSpaces: true, tabSize: indent, eol: '\n' });
  let cursor = 0;
  const parts = [];
  for (const edit of edits) {
    parts.push(doc.text.slice(cursor, edit.offset), edit.content);
    cursor = edit.offset + edit.length;
  }
  parts.push(doc.text.slice(cursor));
  return parts.join('');
}

export function compactDocument(doc) {
  const scanner = createScanner(doc.text, true);
  const parts = [];
  while (scanner.scan() !== SyntaxKind.EOF) parts.push(doc.text.slice(scanner.getTokenOffset(), scanner.getTokenOffset() + scanner.getTokenLength()));
  return parts.join('');
}

export function childEntries(node) {
  if (node.type === 'object') return (node.children || []).map(p => [p.children[0].value, p.children[1]]);
  if (node.type === 'array') return (node.children || []).map((n, i) => [i, n]);
  return [];
}

export function pathFor(parent, key) {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function preview(node, text, max = 180) {
  if (!node) return '';
  if (node.type === 'object') return `{ ${node.children?.length || 0} 个字段 }`;
  if (node.type === 'array') return `[ ${node.children?.length || 0} 项 ]`;
  const raw = text.slice(node.offset, node.offset + Math.min(node.length, max));
  return raw + (node.length > max ? '…' : '');
}

export function treeRows(doc, expanded = [], query = '') {
  const all = expanded === 'all';
  const open = new Set(all ? [] : expanded);
  const rows = [];
  const needle = query.trim().toLocaleLowerCase();
  const stack = [{ node: doc.root, key: '$', path: '$', depth: 0 }];
  while (stack.length) {
    const item = stack.pop();
    const { node, key, path, depth } = item;
    const children = childEntries(node);
    const value = preview(node, doc.text);
    const searchable = `${path} ${node.type === 'string' ? node.value : value}`;
    if (!needle || searchable.toLocaleLowerCase().includes(needle)) {
      rows.push({ key, path, depth, type: node.type, count: children.length, value, offset: node.offset,
        length: node.length, open: !!needle || all || open.has(node.offset) });
    }
    if (needle || all || open.has(node.offset)) {
      for (let i = children.length - 1; i >= 0; i--) {
        const [childKey, child] = children[i];
        stack.push({ node: child, key: childKey, path: pathFor(path, childKey), depth: depth + 1 });
      }
    }
  }
  return rows;
}

function normalizedNumber(raw) {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  let coefficient = (match[2] + (match[3] || '')).replace(/^0+/, '');
  if (!coefficient) return '0';
  const trailing = coefficient.length - coefficient.replace(/0+$/, '').length;
  coefficient = coefficient.slice(0, coefficient.length - trailing);
  const exponent = BigInt(match[4] || '0') - BigInt((match[3] || '').length) + BigInt(trailing);
  return `${match[1]}${coefficient}e${exponent}`;
}

// 两份文档共享结构签名表；无需将整个子树反复序列化，也没有哈希碰撞。
function makeSignatures(doc, ignoreArrayOrder, intern) {
  const ids = new WeakMap();
  const stack = [[doc.root, false]];
  while (stack.length) {
    const [node, visited] = stack.pop();
    const entries = childEntries(node);
    if (!visited && entries.length) {
      stack.push([node, true]);
      for (const [, child] of entries) stack.push([child, false]);
      continue;
    }
    let signature;
    if (node.type === 'object') {
      entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      signature = `o:${JSON.stringify(entries.map(([key, child]) => [key, ids.get(child)]))}`;
    } else if (node.type === 'array') {
      const values = entries.map(([, child]) => ids.get(child));
      if (ignoreArrayOrder) values.sort((a, b) => a - b);
      signature = `a:${values.join(',')}`;
    } else if (node.type === 'number') {
      signature = `n:${normalizedNumber(doc.text.slice(node.offset, node.offset + node.length))}`;
    } else signature = `${node.type}:${JSON.stringify(node.value)}`;
    if (!intern.has(signature)) intern.set(signature, intern.size + 1);
    ids.set(node, intern.get(signature));
  }
  return ids;
}

export function compareDocuments(left, right, { ignoreArrayOrder = false } = {}) {
  for (const [label, doc] of [['原始 JSON', left], ['目标 JSON', right]]) {
    if (doc.duplicates.length) throw new Error(`${label} 存在重复字段 ${JSON.stringify(doc.duplicates[0].key)}，请先消除歧义再对比`);
  }
  const intern = new Map();
  const aIds = makeSignatures(left, ignoreArrayOrder, intern);
  const bIds = makeSignatures(right, ignoreArrayOrder, intern);
  const rows = [];
  const counts = { added: 0, removed: 0, changed: 0 };
  const queue = [{ a: left.root, b: right.root, path: '$' }];
  function add(kind, path, a, b) {
    counts[kind]++;
    rows.push({ kind, path, before: preview(a, left.text), after: preview(b, right.text),
      leftOffset: a?.offset, leftLength: a?.length, rightOffset: b?.offset, rightLength: b?.length });
  }
  while (queue.length) {
    const { a, b, path } = queue.pop();
    if (!a) { add('added', path, a, b); continue; }
    if (!b) { add('removed', path, a, b); continue; }
    if (aIds.get(a) === bIds.get(b)) continue;
    if (a.type !== b.type || (a.type !== 'object' && a.type !== 'array')) {
      add('changed', path, a, b); continue;
    }
    if (a.type === 'object') {
      const aa = new Map(childEntries(a));
      const bb = new Map(childEntries(b));
      const keys = [...new Set([...aa.keys(), ...bb.keys()])];
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        queue.push({ a: aa.get(key), b: bb.get(key), path: pathFor(path, key) });
      }
    } else if (!ignoreArrayOrder) {
      const count = Math.max(a.children.length, b.children.length);
      for (let i = count - 1; i >= 0; i--) queue.push({ a: a.children[i], b: b.children[i], path: pathFor(path, i) });
    } else {
      // 多重集合匹配保留重复项；未匹配的元素分别记录删除与新增。
      const buckets = new Map();
      b.children.forEach((node, index) => {
        const id = bIds.get(node);
        if (!buckets.has(id)) buckets.set(id, { items: [], used: 0 });
        buckets.get(id).items.push(index);
      });
      const matched = new Set();
      a.children.forEach((node, index) => {
        const bucket = buckets.get(aIds.get(node));
        if (bucket && bucket.used < bucket.items.length) matched.add(bucket.items[bucket.used++]);
        else add('removed', pathFor(path, index), node, undefined);
      });
      b.children.forEach((node, index) => {
        if (!matched.has(index)) add('added', pathFor(path, index), undefined, node);
      });
    }
  }
  return { rows, counts };
}
