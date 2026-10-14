import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument } from '../src/core.js';
import { findFocus, searchDocument, graphDocument } from '../src/explore-core.js';
import { layoutGraph, visibleCards, visibleFieldRange, flowGraph, edgeCoordinates, CARD_WIDTH, CARD_HEADER, FIELD_HEIGHT } from '../src/graph-layout.js';

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

test('关键词只匹配字段或值，祖先路径不带出子项，完整路径精确定位', () => {
  const doc = parseDocument(JSON.stringify({ fields: [
    { field_options: { fullscreen: false, display: true, nested: { label: '普通字段' } } },
    { field_options: { fullscreen: true, display: false } },
    { label: 'field_options 配置说明' },
  ] }));
  assert.deepEqual(searchDocument(doc, ' FIELD_OPTIONS ').map(row => [row.path, row.match]), [
    ['$.fields[0].field_options', '字段'],
    ['$.fields[1].field_options', '字段'],
    ['$.fields[2].label', '值'],
  ]);
  assert.equal(searchDocument(doc, 'display').length, 2);
  assert.deepEqual(searchDocument(doc, '$.fields[0].field_options').map(row => [row.path, row.match]), [
    ['$.fields[0].field_options', '路径'],
  ]);
  assert.deepEqual(searchDocument(doc, '$.fields[0].missing'), []);
});

test('结构图默认完整展开，全部数组元素与深层字段无分页', () => {
  const doc = parseDocument(JSON.stringify({ fields: Array.from({ length: 35 }, (_, id) => ({ id, settings: { required: true } })) }));
  const graph = graphDocument(doc);
  const array = graph.cards.find(card => card.path === '$.fields');
  assert.equal(array.rows.length, 35);
  assert.equal(array.rows.at(-1).path, '$.fields[34]');
  assert.ok(graph.cards.some(card => card.path === '$.fields[34].settings'));
  assert.equal(graph.cards.length, 72);
  const closed = graphDocument(doc, { collapsed: [array.id] });
  assert.equal(closed.cards.length, 1);
  const focused = findFocus(doc, searchDocument(doc, '$.fields[34].settings.required')[0].offset);
  assert.ok(focused.ancestors.includes(array.id));
  assert.equal(graphDocument(doc, { collapsed: [array.id].filter(id => !focused.ancestors.includes(id)) }).cards.length, 72);
});

test('标量与空容器也可显示、搜索和定位', () => {
  for (const text of ['null', 'false', '0', '"hello"', '{}', '[]']) {
    const doc = parseDocument(text);
    assert.equal(graphDocument(doc).cards.length, 1);
    assert.equal(findFocus(doc, 0).path, '$');
  }
});

test('结构图类型区分空值与字符串，数组概括所有直接元素并保留折叠后的类型', () => {
  const doc = parseDocument(JSON.stringify({ text: '123', value: 123, enabled: true, empty: null,
    config: {}, pending: [], names: ['a', 'b'], rows: [{ id: 1 }],
    mixed: [1, 'a', null, 'b'], matrix: [[1], ['a']], tail: [...Array(1000).fill(1), false] }));
  const graph = graphDocument(doc);
  assert.equal(graph.cards[0].tsType, 'object');
  assert.deepEqual(graph.cards[0].rows.map(row => row.tsType), [
    'string', 'number', 'boolean', 'null', 'object', 'unknown[]', 'string[]', 'object[]',
    '(null | number | string)[]', 'unknown[][]', '(boolean | number)[]',
  ]);
  assert.equal(graph.cards.find(card => card.path === '$.names').tsType, 'string[]');
  const closed = graphDocument(doc, { collapsed: graph.cards.slice(1).map(card => card.id) });
  assert.deepEqual(closed.cards[0].rows.map(row => row.tsType), graph.cards[0].rows.map(row => row.tsType));
  for (const [text, type] of [['null', 'null'], ['false', 'boolean'], ['0', 'number'], ['"hello"', 'string'], ['[]', 'unknown[]']]) {
    assert.equal(graphDocument(parseDocument(text)).cards[0].tsType, type);
  }
});

test('宽分支不截断卡片数量，图折叠不影响全局搜索结果', () => {
  const doc = parseDocument(JSON.stringify(Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ deep: { same: 1 } })))));
  const graph = graphDocument(doc);
  assert.equal(graph.cards.length, 211);
  const before = searchDocument(doc, 'same');
  graphDocument(doc, { collapsed: graph.cards.slice(1).map(card => card.id) });
  assert.deepEqual(searchDocument(doc, 'same'), before);
  assert.equal(before.length, 100);
  assert.equal(before.at(-1).path, '$[9][9].deep.same');
});

test('十二万行配置：完整图及长卡片按可见范围渲染，精确定位末尾字段', () => {
  const text = JSON.stringify(Array.from({ length: 20000 }, (_, id) => ({ id, label: `字段 ${id}`, required: false, value: '' })), null, 2);
  const doc = parseDocument(text), started = performance.now();
  const graph = graphDocument(doc);
  assert.ok(doc.lines > 100000);
  assert.equal(graph.cards.length, 20001);
  assert.equal(graph.cards[0].rows.length, 20000);
  const layout = layoutGraph(graph);
  const flow = flowGraph(layout);
  assert.equal(flow.nodes.length, 20001);
  assert.equal(flow.nodes[0].height, CARD_HEADER + 20000 * FIELD_HEIGHT);
  assert.equal(flow.canvasEdges, true);
  assert.equal(flow.edges.length, 0);
  assert.equal(layout.edges.length, 20000);
  const lastField = graph.cards.at(-1).rows.find(row => row.key === 'label');
  const target = layout.targets.get(lastField.id);
  assert.equal(target.card.path, '$[19999]');
  assert.equal(target.y, target.card.y + CARD_HEADER + 1.5 * FIELD_HEIGHT);
  const bounds = { left: target.x - 400, right: target.x + 400, top: target.y - 300, bottom: target.y + 300 };
  const visible = visibleCards(layout, bounds);
  assert.ok(visible.length < 12);
  assert.ok(visible.some(card => card.path === '$[19999]'));
  const row = searchDocument(doc, '字段 19999')[0];
  assert.equal(row.path, '$[19999].label');
  assert.equal(findFocus(doc, row.offset).path, row.path);
  const arrayItem = searchDocument(doc, '$[19999]')[0];
  const focus = findFocus(doc, arrayItem.offset);
  assert.equal(focus.path, '$[19999]');
  assert.ok(layout.targets.has(focus.id));
  const primitive = parseDocument(JSON.stringify(Array.from({ length: 20000 }, (_, id) => id)));
  const allValues = layoutGraph(graphDocument(primitive));
  const lastValue = findFocus(primitive, primitive.text.lastIndexOf('19999'));
  const destination = allValues.targets.get(lastValue.id);
  const range = visibleFieldRange(allValues.cards[0], { top: destination.y - 300, bottom: destination.y + 300 });
  assert.equal(range.to, 20000);
  assert.ok(range.to - range.from < 25);
  console.log(`路径索引与搜索：${doc.lines} 行，初始图 ${graph.cards.length} 张卡片，${Math.round(performance.now() - started)} ms`);
});

test('React Flow 节点和连线保留字段位置、重复字段标识及折叠状态', () => {
  const doc = parseDocument('{"group":{"name":"a"},"group":{"name":"b"},"list":[{}]}');
  const layout = layoutGraph(graphDocument(doc));
  const flow = flowGraph(layout);
  assert.equal(flow.canvasEdges, false);
  assert.equal(new Set(flow.nodes.map(node => node.id)).size, layout.cards.length);
  assert.equal(new Set(flow.edges.map(edge => edge.id)).size, layout.edges.length);
  assert.equal(flow.nodes[0].width, CARD_WIDTH);
  for (const [index, edge] of layout.edges.entries()) {
    const { x, y, endX, endY } = edgeCoordinates(layout, edge);
    assert.equal(y, layout.byId.get(edge.from).y + CARD_HEADER + (edge.row + .5) * FIELD_HEIGHT);
    assert.equal(endY, layout.byId.get(edge.to).y + CARD_HEADER / 2);
    assert.equal(flow.edges[index].source, String(edge.from));
    assert.equal(flow.edges[index].target, String(edge.to));
    assert.equal(flow.edges[index].data.path, `M ${x} ${y} C ${x + 42} ${y}, ${endX - 42} ${endY}, ${endX} ${endY}`);
  }
  const collapsed = layoutGraph(graphDocument(doc, { collapsed: layout.cards.slice(1).map(card => card.id) }));
  assert.equal(flowGraph(collapsed).nodes.length, 1);
  assert.equal(flowGraph(collapsed).edges.length, 0);
  assert.equal(flowGraph(layoutGraph(graphDocument(parseDocument('null')))).nodes[0].data.tsType, 'null');
});

test('一级和嵌套字段：整行、值末尾、逗号后均保留具体字段路径', () => {
  const text = '{\n  "same": true,  \n  "group": {\n    "same": "hello",\n    "last": 1\n  },\n  "key": null\n}';
  const doc = parseDocument(text);
  for (const [line, expected] of [[1, '$.same'], [3, '$.group.same'], [4, '$.group.last'], [6, '$.key']]) {
    const lines = text.split('\n');
    const start = lines.slice(0, line).join('\n').length + 1;
    for (let offset = start; offset <= start + lines[line].length; offset++) {
      assert.equal(findFocus(doc, offset).path, expected, `位置 ${offset}`);
    }
  }
  const close = text.indexOf('  },') + 4;
  assert.equal(findFocus(doc, close).path, '$.group');
  assert.equal(findFocus(doc, text.length).path, '$');
});
