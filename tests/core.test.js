import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, formatDocument, compactDocument, treeRows, compareDocuments } from '../src/core.js';

const diff = (a, b, options) => compareDocuments(parseDocument(a), parseDocument(b), options);

test('格式化与压缩保留超大整数、指数与字符串原文', () => {
  const raw = '{"id":9223372036854775807,"huge":1e999,"name":"中国\\n上海","null":null}';
  const formatted = formatDocument(parseDocument(raw), 4);
  assert.ok(formatted.includes('    "id": 9223372036854775807'));
  assert.equal(compactDocument(parseDocument(formatted)), raw);
  assert.equal(diff(raw, formatted).rows.length, 0);
});

test('严格校验语法并返回可定位的错误', () => {
  for (const invalid of ['', '{"a":1,}', '{/*x*/"a":1}', '{a:1}', '{"a":NaN}', '{"a":1} garbage']) {
    assert.throws(() => parseDocument(invalid));
  }
  assert.throws(() => parseDocument('{\n "a":\n}'), error => error.line === 3 && typeof error.offset === 'number');
  for (const valid of ['null', 'true', '0', '[]', '{}', '"字符串"']) assert.doesNotThrow(() => parseDocument(valid));
});

test('按结构比较，忽略字段顺序与数字的等价写法', () => {
  assert.deepEqual(diff('{"b":1e2,"a":-0,"c":1.00}', '{"c":1,"a":0,"b":100.0}').counts, { added: 0, removed: 0, changed: 0 });
  const result = diff('{"id":9223372036854775807}', '{"id":9223372036854775808}');
  assert.equal(result.rows[0].path, '$.id');
  assert.equal(result.rows[0].kind, 'changed');
  assert.equal(result.rows[0].before, '9223372036854775807');
});

test('正确识别新增、删除、修改和特殊键名', () => {
  const result = diff('{"old":1,"x.y":[1,null],"__proto__":0}', '{"new":2,"x.y":[1,false],"__proto__":1}');
  assert.deepEqual(result.counts, { added: 1, removed: 1, changed: 2 });
  assert.ok(result.rows.some(row => row.path === '$["x.y"][1]'));
  assert.ok(result.rows.some(row => row.path === '$.__proto__'));
  assert.equal(diff('{"a":{}}', '{"a":[]}').rows[0].kind, 'changed');
});

test('无序数组按多重集合匹配，保留重复项并递归处理嵌套', () => {
  assert.equal(diff('[1,2]', '[2,1]').counts.changed, 2);
  assert.equal(diff('[1,2]', '[2,1]', { ignoreArrayOrder: true }).rows.length, 0);
  assert.deepEqual(diff('[1,1,2]', '[2,1,2]', { ignoreArrayOrder: true }).counts, { added: 1, removed: 1, changed: 0 });
  assert.equal(diff('[{"b":[1,2],"a":0}]', '[{"a":0,"b":[2,1]}]', { ignoreArrayOrder: true }).rows.length, 0);
  assert.equal(diff('["1",1]', '[1,1]', { ignoreArrayOrder: true }).counts.removed, 1);
});

test('重复字段提供提示且拒绝有歧义的对比', () => {
  const doc = parseDocument('{"x":1,"x":2}');
  assert.equal(doc.duplicates.length, 1);
  assert.throws(() => compareDocuments(doc, doc), /重复字段/);
});

test('树形展开、完整路径搜索以及节点定位', () => {
  const doc = parseDocument('{"a":[{"空 格":"目标"}],"b":false}');
  assert.equal(treeRows(doc).length, 1);
  assert.equal(treeRows(doc, [0]).length, 3);
  const all = treeRows(doc, 'all');
  assert.equal(all.length, 5);
  const row = treeRows(doc, [], '目标')[0];
  assert.equal(row.path, '$.a[0]["空 格"]');
  assert.equal(doc.text.slice(row.offset, row.offset + row.length), '"目标"');
});

test('超过安全嵌套深度时报告原因', () => {
  assert.throws(() => parseDocument('['.repeat(513) + '0' + ']'.repeat(513)), /512/);
});

test('十万行以上真实样本：格式化、树形与差异均完整处理', () => {
  const data = Array.from({ length: 20000 }, (_, id) => ({ id, name: `项目 ${id}`, active: id % 2 === 0, score: id * 3 }));
  const text = JSON.stringify(data, null, 2);
  const started = performance.now();
  const doc = parseDocument(text);
  assert.ok(doc.lines >= 100000);
  const formatted = formatDocument(doc);
  assert.equal(formatted, text);
  assert.equal(treeRows(doc, 'all').length, 100001);
  data[19999].name = '已修改';
  const result = compareDocuments(doc, parseDocument(JSON.stringify(data, null, 2)));
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].path, '$[19999].name');
  console.log(`大文件逻辑验证：${doc.lines} 行，${doc.nodes} 节点，${(text.length / 1024 / 1024).toFixed(2)} Mi 字符，总耗时 ${Math.round(performance.now() - started)} ms`);
});
