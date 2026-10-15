import test from 'node:test';
import assert from 'node:assert/strict';
import share from '../api/share.js';
import { SHARE_MAX_BYTES, SHARE_TTL_SECONDS, SHARE_ID } from '../src/share-config.js';

function setup(t, handler = () => ({ result: 'OK' })) {
  const old = { ...process.env };
  process.env.KV_REST_API_URL = 'https://redis.example';
  process.env.KV_REST_API_TOKEN = 'test-secret';
  t.after(() => { process.env = old; });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const command = JSON.parse(options.body);
    calls.push({ url, command });
    return Response.json(handler(command));
  });
  return calls;
}
const post = (text, headers = {}) => new Request('https://json.example/api/share', { method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8', Origin: 'https://json.example', ...headers }, body: text });
const id = 'Abcdefghijklmnopqrstuv';

test('分享保留原文、精度、重复键与转义，存储七天且使用随机独立 ID', async t => {
  const calls = setup(t);
  const text = '{ "id": 9007199254740993123, "中文": "\\u4e2d", "x":1, "x":2 }';
  const start = Date.now();
  const a = await share.fetch(post(text, { 'x-vercel-forwarded-for': '192.0.2.1' }));
  const b = await share.fetch(post(text));
  const result = await a.json(), other = await b.json();
  assert.equal(a.status, 201);
  assert.match(result.id, SHARE_ID);
  assert.notEqual(result.id, other.id);
  assert.ok(result.expiresAt >= start + SHARE_TTL_SECONDS * 1000);
  assert.equal(calls[0].command[7], text);
  assert.equal(calls[0].command[8], SHARE_TTL_SECONDS);
  assert.equal(calls[0].command[9], Buffer.byteLength(text));
  assert.ok(!JSON.stringify(calls).includes('192.0.2.1'));
  assert.equal(a.headers.get('Cache-Control'), 'no-store');
});

test('十万行 JSON 可以完整分享', async t => {
  const calls = setup(t);
  const text = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ id: i, name: `项目 ${i}`, active: true, score: i })), null, 2);
  assert.equal(text.split('\n').length, 120002);
  assert.equal((await share.fetch(post(text))).status, 201);
  assert.equal(calls[0].command[7], text);
});

test('无效 JSON、空白及过深内容不会进入存储', async t => {
  const calls = setup(t);
  for (const text of ['', '{"x":}', '{"x":1,}', '['.repeat(513) + ']'.repeat(513)]) {
    assert.equal((await share.fetch(post(text))).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('按实际 UTF-8 字节限制大小，缺失或伪造 Content-Length 也无法绕过', async t => {
  const calls = setup(t);
  const text = '"' + '中'.repeat(Math.ceil(SHARE_MAX_BYTES / 3)) + '"';
  assert.equal((await share.fetch(post(text))).status, 413);
  assert.equal((await share.fetch(post(text, { 'Content-Length': '1' }))).status, 413);
  assert.equal(calls.length, 0);
});

test('拒绝跨站创建、不正确的内容类型及修改接口', async t => {
  const calls = setup(t);
  assert.equal((await share.fetch(post('{}', { Origin: 'https://other.example' }))).status, 403);
  assert.equal((await share.fetch(post('{}', { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await share.fetch(post('{}', { 'Content-Type': 'application/json' }))).status, 415);
  const response = await share.fetch(new Request(`https://json.example/api/share?id=${id}`, { method: 'PUT', body: '{}' }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, POST');
  assert.equal(calls.length, 0);
});

test('打开分享返回原文和有效期，HTML 内容不会被当作页面执行', async t => {
  const text = '{"text":"<script>alert(1)</script>","big":9007199254740993123}';
  const calls = setup(t, () => [{ result: text }, { result: 60 }]);
  const response = await share.fetch(new Request(`https://json.example/api/share?id=${id}`));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), text);
  assert.ok(Number(response.headers.get('X-Share-Expires-At')) > Date.now());
  assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls[0].url, 'https://redis.example/multi-exec');
});

test('不存在、过期或格式错误的链接返回明确错误', async t => {
  setup(t, () => [{ result: null }, { result: -2 }]);
  for (const value of [id, 'invalid', '../secret']) {
    const response = await share.fetch(new Request(`https://json.example/api/share?id=${encodeURIComponent(value)}`));
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /无效或已过期/);
  }
});

test('限流和免费额度保护不会返回虚假分享链接', async t => {
  setup(t, () => ({ result: 'rate' }));
  const response = await share.fetch(post('{}'));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '3600');
  assert.equal((await response.json()).id, undefined);
});

test('存储错误与缺少配置不会泄露密钥或 JSON', async t => {
  setup(t, () => ({ error: 'test-secret' }));
  const response = await share.fetch(post('{"private":"data"}'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /test-secret|private/);
  delete process.env.KV_REST_API_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
  assert.equal((await share.fetch(post('{}'))).status, 503);
});
