import { parseTree } from 'jsonc-parser';
import { parseDocument, formatDocument, childEntries, pathFor } from './core.js';

const raw = (node, text) => text.slice(node.offset, node.offset + node.length);
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const isIdent = key => /^[A-Za-z_$][\w$]*$/.test(key);

// 按原文重新输出紧凑 JSON，保留数字原文；sort 按键排序，tweak 可改写对象字段的标量值。
export function serialize(node, text, { sort = false, tweak } = {}) {
  const walk = (n, key) => {
    if (n.type === 'object') {
      let props = n.children || [];
      if (sort) props = [...props].sort((a, b) => cmp(a.children[0].value, b.children[0].value));
      return `{${props.map(p => `${raw(p.children[0], text)}:${walk(p.children[1], p.children[0].value)}`).join(',')}}`;
    }
    if (n.type === 'array') return `[${(n.children || []).map(c => walk(c)).join(',')}]`;
    const value = raw(n, text);
    return tweak && key !== undefined ? tweak(key, n, value) : value;
  };
  return walk(node);
}

export const sortedFormat = (doc, indent) => formatDocument(parseDocument(serialize(doc.root, doc.text, { sort: true })), indent);

// ---------- 类型推断：把所有同级元素合并为一个类型 ----------
const emptyType = () => ({ prims: new Set(), obj: null, count: 0, arr: null });

function infer(node) {
  const t = emptyType();
  if (node.type === 'object') {
    t.obj = new Map();
    t.count = 1;
    for (const [key, child] of childEntries(node)) {
      const field = t.obj.get(key);
      if (field) { merge(field.t, infer(child)); field.count++; } else t.obj.set(key, { t: infer(child), count: 1 });
    }
  } else if (node.type === 'array') {
    t.arr = emptyType();
    for (const child of node.children || []) merge(t.arr, infer(child));
  } else t.prims.add(node.type);
  return t;
}

function merge(a, b) {
  for (const p of b.prims) a.prims.add(p);
  if (b.obj) {
    if (!a.obj) { a.obj = b.obj; a.count = b.count; } else {
      for (const [key, field] of b.obj) {
        const own = a.obj.get(key);
        if (own) { merge(own.t, field.t); own.count += field.count; } else a.obj.set(key, field);
      }
      a.count += b.count;
    }
  }
  if (b.arr) { if (!a.arr) a.arr = b.arr; else merge(a.arr, b.arr); }
  return a;
}

const isUnknown = t => !t.prims.size && !t.obj && !t.arr;
const pascal = name => {
  const value = String(name).split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
  return /^\d/.test(value) ? `_${value}` : value;
};
const singular = name => /ies$/i.test(name) ? name.replace(/ies$/i, 'y') : /[^s]s$/i.test(name) ? name.slice(0, -1) : `${name}Item`;

export function toTypeScript(root) {
  const used = new Set();
  const decls = [];
  const claim = hint => {
    const base = pascal(hint) || 'Item';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}${i}`;
    used.add(name);
    return name;
  };
  const expr = (t, hint) => {
    const parts = [];
    if (t.obj) parts.push(declare(t, hint));
    if (t.arr) {
      const inner = isUnknown(t.arr) ? 'unknown' : expr(t.arr, singular(hint));
      parts.push(`${inner.includes(' | ') ? `(${inner})` : inner}[]`);
    }
    for (const p of ['string', 'number', 'boolean', 'null']) if (t.prims.has(p)) parts.push(p);
    return parts.join(' | ') || 'unknown';
  };
  const declare = (t, hint) => {
    const name = claim(hint);
    const slot = decls.push('') - 1;
    const fields = [...t.obj].map(([key, field]) =>
      `  ${isIdent(key) ? key : JSON.stringify(key)}${field.count < t.count ? '?' : ''}: ${expr(field.t, key)};`);
    decls[slot] = fields.length ? `export interface ${name} {\n${fields.join('\n')}\n}` : `export type ${name} = Record<string, never>;`;
    return name;
  };
  const rootType = infer(root);
  const body = expr(rootType, 'Root');
  if (body !== 'Root') decls.push(`export type Root = ${body};`);
  return `${decls.join('\n\n')}\n`;
}

export function toZod(root) {
  const build = (t, pad) => {
    const parts = [];
    if (t.obj) {
      const inner = `${pad}  `;
      const fields = [...t.obj].map(([key, field]) =>
        `${inner}${isIdent(key) ? key : JSON.stringify(key)}: ${build(field.t, inner)}${field.count < t.count ? '.optional()' : ''},`);
      parts.push(fields.length ? `z.object({\n${fields.join('\n')}\n${pad}})` : 'z.object({})');
    }
    if (t.arr) parts.push(`z.array(${build(t.arr, pad)})`);
    for (const p of ['string', 'number', 'boolean']) if (t.prims.has(p)) parts.push(`z.${p}()`);
    const nullable = t.prims.has('null');
    if (nullable && parts.length === 1) return `${parts[0]}.nullable()`;
    if (nullable) parts.push('z.null()');
    if (!parts.length) return 'z.unknown()';
    return parts.length === 1 ? parts[0] : `z.union([${parts.join(', ')}])`;
  };
  return `import { z } from 'zod';\n\nexport const RootSchema = ${build(infer(root), '')};\n\nexport type Root = z.infer<typeof RootSchema>;\n`;
}

// ---------- 表格 / CSV / YAML / .env ----------
const oneLine = value => value.replace(/\s*\n\s*/g, ' ');
const scalarText = (node, text) => node.type === 'string' ? node.value : raw(node, text);

function flatten(node, text, prefix, out) {
  if (node.type === 'object' && node.children?.length) {
    for (const [key, child] of childEntries(node)) flatten(child, text, prefix ? `${prefix}.${key}` : key, out);
  } else out.set(prefix || 'value', node.type === 'object' || node.type === 'array' ? oneLine(raw(node, text)) : scalarText(node, text));
  return out;
}

// 根对象常是 { code, data: { list: [...] } }：取元素最多的对象数组作为表格行。
function mainRows(root) {
  if (root.type === 'array') return { items: root.children || [], source: '$' };
  let best = null;
  const stack = [{ node: root, path: '$' }];
  while (stack.length) {
    const { node, path } = stack.pop();
    const entries = childEntries(node);
    if (node.type === 'array' && entries.some(([, c]) => c.type === 'object') && (!best || entries.length > best.items.length)) best = { items: node.children, source: path };
    for (let i = entries.length - 1; i >= 0; i--) stack.push({ node: entries[i][1], path: pathFor(path, entries[i][0]) });
  }
  return best || { items: [root], source: '$' };
}

export function tableData(root, text) {
  const { items, source } = mainRows(root);
  const columns = new Map();
  const maps = items.map(item => {
    const cells = flatten(item, text, '', new Map());
    for (const key of cells.keys()) columns.set(key, true);
    return cells;
  });
  const names = [...columns.keys()];
  return { columns: names, rows: maps.map(cells => names.map(name => cells.get(name) ?? '')), source };
}

export function toCsv(root, text) {
  const { columns, rows } = tableData(root, text);
  const cell = value => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [columns, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
}

const yamlString = value => value !== '' && /^[A-Za-z_/][\w/.-]*( [\w/.-]+)*$/.test(value) && !/^(true|false|null|yes|no|on|off|y|n)$/i.test(value)
  ? value : JSON.stringify(value);

export function toYaml(root, text) {
  const scalar = node => node.type === 'string' ? yamlString(node.value)
    : node.type === 'object' ? (node.children?.length ? null : '{}')
    : node.type === 'array' ? (node.children?.length ? null : '[]') : raw(node, text);
  const dump = (node, pad) => {
    const out = [];
    const isArray = node.type === 'array';
    for (const [key, child] of childEntries(node)) {
      const value = scalar(child);
      if (value !== null) { out.push(isArray ? `${pad}- ${value}` : `${pad}${yamlString(key)}: ${value}`); continue; }
      const sub = dump(child, `${pad}  `);
      if (isArray) out.push(`${pad}- ${sub[0].slice(pad.length + 2)}`, ...sub.slice(1));
      else out.push(`${pad}${yamlString(key)}:`, ...sub);
    }
    return out;
  };
  const value = scalar(root);
  return `${value ?? dump(root, '').join('\n')}\n`;
}

export function toEnv(root, text) {
  const lines = [];
  const walk = (node, name) => {
    const entries = childEntries(node);
    if (entries.length) { for (const [key, child] of entries) walk(child, name ? `${name}_${key}` : String(key)); return; }
    const value = node.type === 'null' ? '' : node.type === 'object' ? '{}' : node.type === 'array' ? '[]' : scalarText(node, text);
    const key = name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase() || 'VALUE';
    lines.push(`${/^\d/.test(key) ? `_${key}` : key}=${/[\s#"'\\$`]/.test(value) ? JSON.stringify(value) : value}`);
  };
  walk(root, '');
  return `${lines.join('\n')}\n`;
}

// ---------- Mock：把数组扩充到 N 条，id 类字段自增 ----------
const idKey = key => /^id$/i.test(key) || /[_-]id$/i.test(key) || /[a-z]Id$/.test(key);
const bump = i => (key, node, value) => {
  if (!idKey(key)) return value;
  if (node.type === 'number' && /^-?\d+$/.test(value)) return String(BigInt(value) + BigInt(i));
  if (node.type === 'string') {
    const v = node.value;
    return JSON.stringify(/^\d+$/.test(v) ? (BigInt(v) + BigInt(i)).toString().padStart(v.length, '0') : `${v}-${i + 1}`);
  }
  return value;
};

export function mockDocument(doc, count, indent = 2) {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error('条数需为 1 到 10000 的整数');
  const templates = doc.root.type === 'array' && doc.root.children?.length ? doc.root.children : [doc.root];
  const items = Array.from({ length: count }, (_, i) =>
    serialize(templates[i % templates.length], doc.text, i < templates.length ? {} : { tweak: bump(i) }));
  return formatDocument(parseDocument(`[${items.join(',')}]`), indent);
}

// ---------- 嵌套转义 ----------
const isJsonContainer = value => {
  if (!/^\s*[{[]/.test(value)) return false;
  const errors = [];
  return !!parseTree(value, errors, { disallowComments: true }) && !errors.length;
};

export function unescapeJson(text, depth = 0) {
  const errors = [];
  const root = parseTree(text, errors, { disallowComments: true });
  if (!root || errors.length) return { text, count: 0 };
  const edits = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === 'string') {
      // 根节点是被整体转义的字符串（"\"{...}\""）时再多解一层。
      const nested = isJsonContainer(node.value);
      const wrapped = node === root && /^\s*"/.test(node.value) && (parseTree(node.value, []) ?? {}).type === 'string';
      if (nested || wrapped) edits.push({ node, value: node.value });
    } else for (const [, child] of childEntries(node)) stack.push(child);
  }
  let count = 0;
  let result = text;
  for (const { node, value } of edits.sort((a, b) => b.node.offset - a.node.offset)) {
    const inner = depth < 8 ? unescapeJson(value, depth + 1) : { text: value, count: 0 };
    count += 1 + inner.count;
    result = result.slice(0, node.offset) + inner.text + result.slice(node.offset + node.length);
  }
  return { text: result, count };
}

// ---------- 宽松 JSON 修复与提取 ----------
function shellWord(s, start) {
  let i = start, out = '';
  const escapes = { n: '\n', t: '\t', r: '\r' };
  while (i < s.length && !/\s/.test(s[i])) {
    if (s[i] === '$' && s[i + 1] === "'") {
      for (i += 2; i < s.length && s[i] !== "'"; i++) {
        if (s[i] !== '\\') { out += s[i]; continue; }
        const c = s[++i];
        if (c === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; } else out += escapes[c] ?? c;
      }
      i++;
    } else if (s[i] === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) return [out + s.slice(i + 1), s.length];
      out += s.slice(i + 1, end);
      i = end + 1;
    } else if (s[i] === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && '"\\$`'.includes(s[i + 1])) i++;
        out += s[i];
      }
      i++;
    } else out += s[i++];
  }
  return [out, i];
}

function curlBody(s) {
  if (!/^\s*curl\b/.test(s)) return null;
  const flag = /(?:^|\s)(?:-d|--data(?:-raw|-binary|-ascii)?|--json)(?:\s+|=)/g;
  for (let m; (m = flag.exec(s));) {
    const [word] = shellWord(s, flag.lastIndex);
    if (word && !word.startsWith('@')) return word;
  }
  return null;
}

function jsString(s, start) {
  const quote = s[start], escapes = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
  let out = '';
  for (let i = start + 1; i < s.length; i++) {
    if (s[i] === quote) return out;
    if (s[i] !== '\\') { out += s[i]; continue; }
    const c = s[++i];
    if (c === 'u') { out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16)); i += 4; } else out += escapes[c] ?? c;
  }
  return out;
}

// 从 start 起取第一个括号配平的 {...} / [...]；字符串内的括号不计。
function balancedSlice(s, start = 0) {
  const from = s.slice(start).search(/[{[]/);
  if (from < 0) return null;
  let depth = 0, quote = '';
  for (let i = start + from; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return s.slice(start + from, i + 1);
  }
  return s.slice(start + from);
}

function fetchBody(s) {
  if (!/\bfetch\s*\(/.test(s)) return null;
  const m = /\bbody\s*:\s*/.exec(s);
  if (!m) return null;
  const at = m.index + m[0].length;
  if (/["'`]/.test(s[at])) return jsString(s, at);
  const call = /^JSON\.stringify\(\s*/.exec(s.slice(at));
  return balancedSlice(s, at + (call ? call[0].length : 0));
}

export function lenientJson(src) {
  const pieces = [];
  const dropComma = () => {
    let j = pieces.length - 1;
    while (j >= 0 && /^\s+$/.test(pieces[j])) j--;
    if (pieces[j] === ',') pieces.splice(j, 1);
  };
  for (let i = 0; i < src.length;) {
    const rest = src.slice(i, i + 64);
    let m;
    if ((m = /^\s+/.exec(rest))) { pieces.push(m[0]); i += m[0].length; }
    else if (rest.startsWith('//')) { const end = src.indexOf('\n', i); i = end < 0 ? src.length : end; }
    else if (rest.startsWith('/*')) { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; }
    else if (rest[0] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      pieces.push(src.slice(i, j + 1)); i = j + 1;
    } else if (rest[0] === "'" || rest[0] === '`') {
      const quote = rest[0];
      let j = i + 1, body = '';
      for (; j < src.length && src[j] !== quote; j++) {
        if (src[j] === '\\') {
          const c = src[++j];
          body += c === "'" || c === '`' ? c : `\\${c}`;
        } else body += src[j] === '"' ? '\\"' : src[j] === '\n' ? '\\n' : src[j];
      }
      pieces.push(`"${body}"`); i = j + 1;
    } else if (rest[0] === '}' || rest[0] === ']') { dropComma(); pieces.push(rest[0]); i++; }
    else if ('{[,:'.includes(rest[0])) { pieces.push(rest[0]); i++; }
    else if ((m = /^[+-]?(?:Infinity|NaN)\b/.exec(rest))) { pieces.push('null'); i += m[0].length; }
    else if ((m = /^[+-]?0[xX][0-9a-fA-F]+/.exec(rest))) {
      pieces.push((m[0][0] === '-' ? '-' : '') + BigInt(m[0].replace(/^[+-]/, '')).toString()); i += m[0].length;
    } else if ((m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest))) {
      const sign = m[0][0] === '-' ? '-' : '';
      let digits = m[0].replace(/^[+-]/, '');
      if (digits[0] === '.') digits = `0${digits}`;
      pieces.push(sign + digits.replace(/\.(?=$|[eE])/, '')); i += m[0].length;
    } else if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      const word = m[0];
      if (word === 'undefined') pieces.push('null');
      else if (/^(true|false|null)$/.test(word)) pieces.push(word);
      else if (/^\s*:/.test(src.slice(i + word.length, i + word.length + 32))) pieces.push(JSON.stringify(word));
      else pieces.push(word);
      i += word.length;
    } else { pieces.push(rest[0]); i++; }
  }
  return pieces.join('');
}

const valid = s => { try { parseDocument(s); return true; } catch { return false; } };

// 依次尝试：cURL / fetch 请求体 → 日志里的 JSON 片段 → 宽松语法修复。
export function repairText(text) {
  if (valid(text)) return { text, steps: [] };
  let s = text;
  const steps = [];
  const body = curlBody(s) ?? fetchBody(s);
  if (body != null) { s = body; steps.push('提取请求体'); }
  if (!valid(s)) {
    const slice = balancedSlice(s);
    if (slice && slice !== s.trim()) { s = slice; steps.push('截取其中的 JSON'); }
    const fixed = lenientJson(s);
    if (fixed !== s) { s = fixed; steps.push('修复宽松语法'); }
  }
  if (!valid(s)) throw new Error('无法自动修复为合法 JSON，请手动检查');
  return { text: s, steps };
}

// ---------- JSONPath ----------
const LIMIT = 5000;

function closeBracket(q, start) {
  let depth = 0, quote = '';
  for (let i = start; i < q.length; i++) {
    const c = q[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

function splitOutside(s, sep) {
  const parts = [];
  let quote = '', last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (s.startsWith(sep, i)) { parts.push(s.slice(last, i)); i += sep.length - 1; last = i + 1; }
  }
  parts.push(s.slice(last));
  return parts;
}

function parseLiteral(src) {
  if (/^(['"]).*\1$/s.test(src)) return src.slice(1, -1);
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(src)) return Number(src);
  if (src === 'true') return true;
  if (src === 'false') return false;
  if (src === 'null') return null;
  const re = /^\/(.*)\/([a-z]*)$/s.exec(src);
  if (re) return new RegExp(re[1], re[2]);
  throw new Error(`JSONPath 过滤条件的值无法识别：${src}`);
}

function parseAtom(src) {
  const m = /^(@[^\s=!<>~]*)\s*(==|!=|>=|<=|=~|>|<)?\s*([\s\S]*)$/.exec(src.trim().replace(/^\(+|\)+$/g, '').trim());
  if (!m) throw new Error(`JSONPath 过滤条件无法识别：${src.trim()}`);
  const steps = parsePath(`$${m[1].slice(1)}`);
  const op = m[2], literal = op ? parseLiteral(m[3].trim()) : undefined;
  return (node, ctx) => {
    const found = run(ctx, { node, path: '$' }, steps)[0];
    if (!op) return !!found;
    if (!found) return op === '!=';
    const n = found.node;
    const value = n.type === 'number' ? Number(raw(n, ctx.text)) : n.type === 'string' || n.type === 'boolean' ? n.value : n.type === 'null' ? null : undefined;
    if (op === '==') return value === literal;
    if (op === '!=') return value !== literal;
    if (op === '=~') return typeof value === 'string' && literal instanceof RegExp && literal.test(value);
    if (typeof value !== typeof literal || (typeof value !== 'number' && typeof value !== 'string')) return false;
    return op === '>' ? value > literal : op === '<' ? value < literal : op === '>=' ? value >= literal : value <= literal;
  };
}

function parseFilter(src) {
  const groups = splitOutside(src, '||').map(or => splitOutside(or, '&&').map(parseAtom));
  return (node, ctx) => groups.some(ands => ands.every(test => test(node, ctx)));
}

function parseBracket(body) {
  const b = body.trim();
  if (b === '*') return [{ k: 'wild' }];
  if (b.startsWith('?')) return [{ k: 'filter', f: parseFilter(b.replace(/^\?\s*\(?/, '').replace(/\)\s*$/, '')) }];
  return splitOutside(b, ',').map(part => {
    const p = part.trim();
    let m;
    if (/^-?\d+$/.test(p)) return { k: 'index', v: Number(p) };
    if ((m = /^(-?\d*):(-?\d*)(?::(\d*))?$/.exec(p))) {
      return { k: 'slice', a: m[1] === '' ? null : +m[1], b: m[2] === '' ? null : +m[2], s: m[3] ? +m[3] : 1 };
    }
    if (/^(['"]).*\1$/s.test(p)) return { k: 'name', v: p.slice(1, -1).replace(/\\(['"\\])/g, '$1') };
    throw new Error(`JSONPath 方括号内容无法识别：${p}`);
  });
}

export function parsePath(query) {
  const q = query.trim();
  if (q[0] !== '$') throw new Error('JSONPath 需以 $ 开头，例如 $.list[*].id');
  const steps = [];
  const fail = i => { throw new Error(`JSONPath 语法错误（第 ${i + 1} 个字符）`); };
  for (let i = 1; i < q.length;) {
    let desc = false;
    if (q.startsWith('..', i)) { desc = true; i += 2; } else if (q[i] === '.') i++; else if (q[i] !== '[') fail(i);
    if (q[i] === '[') {
      const end = closeBracket(q, i);
      if (end < 0) fail(i);
      steps.push({ desc, sels: parseBracket(q.slice(i + 1, end)) });
      i = end + 1;
    } else if (q[i] === '*') { steps.push({ desc, sels: [{ k: 'wild' }] }); i++; }
    else {
      const m = /^[^.[\s*]+/.exec(q.slice(i));
      if (!m) fail(i);
      steps.push({ desc, sels: [{ k: 'name', v: m[0] }] });
      i += m[0].length;
    }
  }
  return steps;
}

function pick(ctx, { node, path }, sels) {
  const out = [];
  const entries = childEntries(node);
  const isArray = node.type === 'array';
  for (const sel of sels) {
    if (sel.k === 'name') {
      if (node.type === 'object') for (const [key, child] of entries) if (key === sel.v) out.push({ node: child, path: pathFor(path, key) });
    } else if (sel.k === 'index') {
      const at = sel.v < 0 ? entries.length + sel.v : sel.v;
      if (isArray && entries[at]) out.push({ node: entries[at][1], path: pathFor(path, at) });
    } else if (sel.k === 'slice') {
      if (!isArray) continue;
      if (sel.s <= 0) throw new Error('JSONPath 切片步长需为正数');
      const len = entries.length, norm = (v, d) => v === null ? d : Math.max(0, Math.min(len, v < 0 ? len + v : v));
      for (let i = norm(sel.a, 0); i < norm(sel.b, len); i += sel.s) out.push({ node: entries[i][1], path: pathFor(path, i) });
    } else {
      for (const [key, child] of entries) if (sel.k === 'wild' || sel.f(child, ctx)) out.push({ node: child, path: pathFor(path, key) });
    }
  }
  return out;
}

function descendantsOrSelf(item) {
  const out = [], stack = [item];
  while (stack.length) {
    const cur = stack.pop();
    out.push(cur);
    const entries = childEntries(cur.node);
    for (let i = entries.length - 1; i >= 0; i--) stack.push({ node: entries[i][1], path: pathFor(cur.path, entries[i][0]) });
  }
  return out;
}

function run(ctx, start, steps) {
  let current = [start];
  for (const step of steps) {
    const next = [];
    for (const item of current) {
      for (const base of step.desc ? descendantsOrSelf(item) : [item]) {
        next.push(...pick(ctx, base, step.sels));
        if (next.length > LIMIT * 4) break;
      }
    }
    current = next;
  }
  return current;
}

export function queryPath(doc, query) {
  const steps = parsePath(query);
  const found = run({ text: doc.text }, { node: doc.root, path: '$' }, steps);
  const matches = found.slice(0, LIMIT).map(({ node, path }) => ({
    path, offset: node.offset, length: node.length,
    preview: oneLine(raw(node, doc.text).slice(0, 160)),
    text: raw(node, doc.text),
  }));
  return { total: found.length, truncated: found.length > LIMIT, matches,
    json: `[${matches.map(m => m.text).join(',')}]` };
}

// ---------- 悬停解码：时间戳 / JWT / Base64 ----------
const decodeBase64 = s => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - t.length % 4) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
};
const stamp = ms => `${new Date(ms).toLocaleString('zh-CN', { hour12: false })}（本地）\n${new Date(ms).toISOString()}（UTC）`;
const timestampInfo = digits => {
  const ms = digits.length === 10 ? Number(digits) * 1000 : Number(digits);
  return ms >= 9.4e11 && ms <= 4.1e12 ? { title: digits.length === 10 ? '时间戳（秒）' : '时间戳（毫秒）', text: stamp(ms) } : null;
};

function stringInfo(value) {
  if (/^\d{10}$|^\d{13}$/.test(value)) return timestampInfo(value);
  try {
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(value)) {
      const [head, body] = value.split('.', 2).map(decodeBase64);
      const payload = JSON.parse(body);
      const times = ['exp', 'iat', 'nbf', 'auth_time'].filter(k => Number.isFinite(payload[k]))
        .map(k => `${k} → ${new Date(payload[k] * 1000).toLocaleString('zh-CN', { hour12: false })}`);
      return { title: 'JWT（仅解码，未验证签名）', text: [JSON.stringify(JSON.parse(head), null, 2), JSON.stringify(payload, null, 2), ...times].join('\n') };
    }
    if (/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(value)) {
      const decoded = decodeBase64(value);
      if (decoded.length >= 4 && /^[\p{L}\p{N}\p{P}\p{S}\p{Z}\n\r\t]+$/u.test(decoded)) return { title: 'Base64 解码', text: decoded.slice(0, 2000) };
    }
  } catch { /* 不是合法编码 */ }
  return null;
}

export function hoverInfo(line, col) {
  const re = /"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (let m; (m = re.exec(line));) {
    if (col < m.index || col >= m.index + m[0].length) continue;
    let info = null;
    if (m[0][0] !== '"') info = /^\d{10}$|^\d{13}$/.test(m[0]) ? timestampInfo(m[0]) : null;
    else { try { info = stringInfo(JSON.parse(m[0])); } catch { /* 字符串转义不合法 */ } }
    return info && { ...info, from: m.index, to: m.index + m[0].length };
  }
  return null;
}
