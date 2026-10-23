import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, compareDocuments } from '../src/core.js';
import { toTypeScript, toZod, toCsv, toYaml, toEnv, tableData, mockDocument, unescapeJson, repairText, lenientJson, queryPath, sortedFormat, hoverInfo } from '../src/tools-core.js';

const doc = text => parseDocument(text);
const root = text => doc(text).root;
const paths = (text, query) => queryPath(doc(text), query).matches.map(m => m.path);

test('TypeScript：合并数组元素、可选字段、联合类型与命名', () => {
  const ts = toTypeScript(root('{"id":1,"tags":["a"],"mix":[1,"x"],"users":[{"name":"a","age":1,"addr":null},{"name":"b","addr":{"city":"c"}}],"a-b":true}'));
  assert.match(ts, /export interface Root \{/);
  assert.match(ts, /  id: number;/);
  assert.match(ts, /  tags: string\[\];/);
  assert.match(ts, /  mix: \(string \| number\)\[\];/);
  assert.match(ts, /  users: User\[\];/);
  assert.match(ts, /  "a-b": boolean;/);
  assert.match(ts, /export interface User \{\n  name: string;\n  age\?: number;\n  addr: Addr \| null;/);
  assert.match(ts, /export interface Addr \{\n  city: string;/);
  assert.equal(toTypeScript(root('[1,2]')), 'export type Root = number[];\n');
  assert.match(toTypeScript(root('{"e":[]}')), /e: unknown\[\];/);
});

test('Zod：可选、可空与联合', () => {
  const zod = toZod(root('[{"a":1,"b":null},{"a":2}]'));
  assert.match(zod, /z\.array\(z\.object\(\{\n  a: z\.number\(\),\n  b: z\.null\(\)\.optional\(\),/);
  assert.match(toZod(root('{"x":[1,"a",null]}')), /x: z\.array\(z\.union\(\[z\.string\(\), z\.number\(\), z\.null\(\)\]\)\)/);
  assert.match(toZod(root('{"x":"a","y":null}')), /y: z\.null\(\)/);
});

test('表格 / CSV / YAML / .env', () => {
  const text = '[{"id":9223372036854775807,"u":{"n":"a,b"},"t":[1,2]},{"id":2,"q":"x\\"y"}]';
  assert.deepEqual(tableData(doc(text).root, text).columns, ['id', 'u.n', 't', 'q']);
  assert.equal(toCsv(doc(text).root, text), 'id,u.n,t,q\r\n9223372036854775807,"a,b","[1,2]",\r\n2,,,"x""y"');
  const yaml = '{"a":{"b":[1,{"c":"x y","d":"true"}],"e":[]},"nn":null,"s":"1.0"}';
  assert.equal(toYaml(doc(yaml).root, yaml), 'a:\n  b:\n    - 1\n    - c: x y\n      d: "true"\n  e: []\nnn: null\ns: "1.0"\n');
  const env = '{"db":{"host":"h","pass":"a b","ports":[1,2]},"x":null}';
  assert.equal(toEnv(doc(env).root, env), 'DB_HOST=h\nDB_PASS="a b"\nDB_PORTS_0=1\nDB_PORTS_1=2\nX=\n');
});

test('表格取根对象中最大的对象数组', () => {
  const text = '{"code":0,"data":{"list":[{"id":1},{"id":2}],"tiny":[{"x":1}]}}';
  const t = tableData(doc(text).root, text);
  assert.deepEqual([t.source, t.columns, t.rows], ['$.data.list', ['id'], [['1'], ['2']]]);
  assert.equal(tableData(doc('{"a":1}').root, '{"a":1}').source, '$');
});

test('Mock：循环扩充并让 id 自增', () => {
  const out = JSON.parse(mockDocument(doc('[{"id":1,"name":"a"},{"id":"007","userId":5}]'), 5));
  assert.equal(out.length, 5);
  assert.deepEqual(out[0], { id: 1, name: 'a' });
  assert.deepEqual(out[2], { id: 3, name: 'a' });
  assert.equal(out[3].id, '010');
  assert.equal(out[3].userId, 8);
  assert.throws(() => mockDocument(doc('[]'), 0));
});

test('键排序保留原始数字', () => {
  assert.equal(sortedFormat(doc('{"b":9223372036854775807,"a":{"z":1,"y":[{"d":1,"c":2}]}}'), 1),
    '{\n "a": {\n  "y": [\n   {\n    "c": 2,\n    "d": 1\n   }\n  ],\n  "z": 1\n },\n "b": 9223372036854775807\n}');
});

test('展开 / 修复嵌套转义', () => {
  const nested = JSON.stringify({ a: JSON.stringify({ b: JSON.stringify([1]) }), s: 'plain', q: '"quoted"' });
  const { text, count } = unescapeJson(nested);
  assert.equal(count, 2);
  assert.deepEqual(JSON.parse(text), { a: { b: [1] }, s: 'plain', q: '"quoted"' });
  assert.equal(unescapeJson(JSON.stringify(JSON.stringify({ k: 1 }))).text, '{"k":1}');
  assert.equal(unescapeJson('{"a":1}').count, 0);
});

test('宽松 JSON、cURL、fetch、日志提取', () => {
  assert.deepEqual(JSON.parse(lenientJson("{a:1, 'b':'it\\'s \"x\"', // c\n c:[1,2,], d:undefined, e:.5, f:+3, g:0x10, h:NaN, /* x */}")),
    { a: 1, b: 'it\'s "x"', c: [1, 2], d: null, e: 0.5, f: 3, g: 16, h: null });
  assert.deepEqual(repairText('{"ok":true}'), { text: '{"ok":true}', steps: [] });
  const curl = `curl 'https://x.io/api' \\\n  -H 'content-type: application/json' \\\n  --data-raw $'{"name":"\\u4e2d","q":"it\\'s"}'`;
  assert.deepEqual(JSON.parse(repairText(curl).text), { name: '中', q: "it's" });
  const fetchText = `fetch("/api", { method: "POST", body: "{\\"a\\":1}" })`;
  assert.deepEqual(JSON.parse(repairText(fetchText).text), { a: 1 });
  assert.deepEqual(JSON.parse(repairText('fetch("/x",{body: JSON.stringify({a: 1, b: [2]})})').text), { a: 1, b: [2] });
  assert.deepEqual(JSON.parse(repairText('2025-01-01 INFO resp={"a":"}{","b":[1]} done').text), { a: '}{', b: [1] });
  assert.throws(() => repairText('not json at all'));
});

test('JSONPath：子项、通配、递归、切片、过滤', () => {
  const text = '{"list":[{"id":1,"n":"a","p":5},{"id":2,"n":"b","p":15,"c":{"id":9}}],"o":{"id":0}}';
  assert.deepEqual(paths(text, '$.list[*].id'), ['$.list[0].id', '$.list[1].id']);
  assert.deepEqual(paths(text, '$..id'), ['$.list[0].id', '$.list[1].id', '$.list[1].c.id', '$.o.id']);
  assert.deepEqual(paths(text, '$.list[-1].n'), ['$.list[1].n']);
  assert.deepEqual(paths(text, '$.list[0:1].n'), ['$.list[0].n']);
  assert.deepEqual(paths(text, '$.list[?(@.p > 10)].n'), ['$.list[1].n']);
  assert.deepEqual(paths(text, "$.list[?(@.n == 'a' || @.c)].id"), ['$.list[0].id', '$.list[1].id']);
  assert.deepEqual(paths(text, '$.list[?(@.c.id == 9 && @.p >= 15)].id'), ['$.list[1].id']);
  assert.deepEqual(paths(text, "$['o']['id']"), ['$.o.id']);
  assert.equal(queryPath(doc('{"v":9223372036854775807}'), '$.v').json, '[9223372036854775807]');
  assert.equal(queryPath(doc(text), '$.none').total, 0);
  assert.throws(() => queryPath(doc(text), 'list'));
  assert.throws(() => queryPath(doc(text), '$.list['));
});

test('对比忽略字段：字段名、路径与通配', () => {
  const a = doc('{"ts":1,"d":[{"id":1,"trace":"x"},{"id":2,"trace":"y"}],"k":{"ts":5}}');
  const b = doc('{"ts":2,"d":[{"id":1,"trace":"p"},{"id":2,"trace":"q"}],"k":{"ts":6}}');
  assert.equal(compareDocuments(a, b).rows.length, 4);
  assert.equal(compareDocuments(a, b, { ignore: ['ts', 'trace'] }).rows.length, 0);
  assert.deepEqual(compareDocuments(a, b, { ignore: ['$.ts', '$.d[*].trace'] }).rows.map(r => r.path), ['$.k.ts']);
  assert.equal(compareDocuments(a, b, { ignore: ['ts', '$.d[0].trace'] }).rows.length, 1);
  assert.equal(compareDocuments(a, b, { ignore: ['ts', 'trace'], ignoreArrayOrder: true }).rows.length, 0);
});

test('悬停解码时间戳、JWT 与 Base64', () => {
  assert.match(hoverInfo('"t": 1700000000,', 7).text, /2023-11-14T22:13:20/);
  assert.match(hoverInfo('"t": 1700000000123', 7).title, /毫秒/);
  assert.equal(hoverInfo('"n": 123456', 7), null);
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"sub":"u1","exp":1700000000}').toString('base64url')}.sig`;
  const info = hoverInfo(`"token": "${jwt}"`, 12);
  assert.match(info.title, /JWT/);
  assert.match(info.text, /"sub": "u1"/);
  assert.equal(hoverInfo(`"b": "${Buffer.from('hello world, 你好').toString('base64')}"`, 8).text, 'hello world, 你好');
  assert.equal(hoverInfo('"w": "internationalization"', 8), null);
});
