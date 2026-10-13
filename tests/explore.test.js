import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../src/core.js';
import { findFocus, searchDocument, graphDocument } from '../src/explore-core.js';

test('光标路径包含数组下标和特殊键名，属性名和值都能定位', () => {
  const text = '{\n  "fields": [{"a.b": {"空 格": "目标值"}, "next": true}]\n}';
  const doc = parseDocument(text);
  for (const pos of [text.indexOf('"空 格"'), text.indexOf('目标值')]) {
    const focus = findFocus(doc, pos);
    assert.equal(focus.path, '$.fields[0]["a.b"]["空 格"]');
    assert.equal(focus.line, 2);
    assert.equal(focus.type, 'string');
  }
  assert.equal(findFocus(doc, text.indexOf('}, "next"')).path, '$.fields[0]["a.b"]');
  assert.equal(findFocus(doc, text.lastIndexOf('}')).path, '$');
  assert.equal(findFocus(doc, text.length).path, '$');
  const indented = parseDocument('{\n  "first": 1,\n  "second": 2\n}');
  assert.equal(findFocus(indented, indented.text.indexOf('  "second"')).path, '$.second');
});

test('搜索涵盖字段、完整值、路径和转义字符串，并保留数值精度', () => {
  const doc = parseDocument('{"list":[{"label":"姓名","id":9223372036854775807,"text":"' + 'a'.repeat(300) + '末尾目标"}],"escaped":"\\u4e2d\\u6587"}');
  const label = searchDocument(doc, '姓名')[0];
  assert.equal(label.path, '$.list[0].label');
  assert.equal(doc.text.slice(label.valueOffset, label.valueOffset + label.valueLength), '"姓名"');
  assert.equal(searchDocument(doc, '9223372036854775807')[0].value, '9223372036854775807');
  assert.ok(searchDocument(doc, '末尾目标')[0].value.includes('末尾目标'));
  assert.equal(searchDocument(doc, '$.list[0].id')[0].path, '$.list[0].id');
  assert.equal(searchDocument(doc, '中文')[0].path, '$.escaped');
  assert.equal(searchDocument(doc, 'LABEL')[0].match, '字段');
  assert.deepEqual(searchDocument(doc, '  '), []);
});

test('重复字段按原文位置分别显示，路径不会被覆盖', () => {
  const doc = parseDocument('{"name":"a","name":"b"}');
  const rows = searchDocument(doc, 'name');
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].offset, rows[1].offset);
  assert.equal(findFocus(doc, rows[1].offset).value, '"b"');
});

test('结构图展开、收起、分支与分页可访问完整数组', () => {
  const doc = parseDocument(JSON.stringify({ fields: Array.from({ length: 35 }, (_, id) => ({ id, settings: { required: true } })) }));
  const first = graphDocument(doc);
  const array = first.cards.find(card => card.path === '$.fields');
  assert.equal(array.rows.length, 10);
  const last = graphDocument(doc, { rootId: array.id, pages: { [array.id]: 3 } });
  assert.equal(last.cards[0].rows[0].key, 30);
  assert.equal(last.cards[0].rows.at(-1).path, '$.fields[34]');
  const closed = graphDocument(doc, { collapsed: [array.id] });
  assert.equal(closed.cards.length, 1);
  const expanded = graphDocument(doc, { rootId: array.id, pages: { [array.id]: 99 } });
  assert.equal(expanded.cards[0].page, 3);
});

test('标量与空容器也可显示、搜索和定位', () => {
  for (const text of ['null', 'false', '0', '"hello"', '{}', '[]']) {
    const doc = parseDocument(text);
    assert.equal(graphDocument(doc).cards.length, 1);
    assert.equal(findFocus(doc, 0).path, '$');
  }
});

test('宽分支图达到显示预算后仍可单独进入任意分支', () => {
  const doc = parseDocument(JSON.stringify(Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ deep: { value: 1 } })))));
  const graph = graphDocument(doc);
  assert.equal(graph.cards.length, 80);
  const row = searchDocument(doc, '$[9][9].deep.value')[0];
  const focus = findFocus(doc, row.offset);
  assert.equal(graphDocument(doc, { rootId: focus.containerId }).root.path, '$[9][9].deep');
});

test('十二万行配置：全量搜索末尾节点，图模型有界且直接定位正确页', () => {
  const text = JSON.stringify(Array.from({ length: 20000 }, (_, id) => ({ id, label: `字段 ${id}`, required: false, value: '' })), null, 2);
  const doc = parseDocument(text), started = performance.now();
  const graph = graphDocument(doc);
  assert.ok(doc.lines > 100000);
  assert.ok(graph.cards.length <= 80);
  assert.ok(graph.cards.every(card => card.rows.length <= 10));
  const row = searchDocument(doc, '字段 19999')[0];
  assert.equal(row.path, '$[19999].label');
  assert.equal(findFocus(doc, row.offset).path, row.path);
  const arrayItem = searchDocument(doc, '$[19999]')[0];
  const focus = findFocus(doc, arrayItem.offset);
  assert.equal(focus.path, '$[19999]');
  const branch = graphDocument(doc, { rootId: focus.containerId });
  assert.equal(branch.root.path, '$[19999]');
  const primitive = parseDocument(JSON.stringify(Array.from({ length: 20000 }, (_, id) => id)));
  assert.equal(findFocus(primitive, primitive.text.lastIndexOf('19999')).containerPage, 1999);
  console.log(`路径索引与搜索：${doc.lines} 行，初始图 ${graph.cards.length} 张卡片，${Math.round(performance.now() - started)} ms`);
});
