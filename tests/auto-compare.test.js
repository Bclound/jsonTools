import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createAutoCompare } from '../src/auto-compare.js';
import { compareInputDocuments } from '../src/core.js';

async function until(condition) {
  const end = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < end, '等待异步对比结果超时');
    await wait(5);
  }
}

test('连续输入合并计算，正在计算的旧结果不覆盖新输入', async () => {
  let input = 'old';
  const requests = [], results = [], errors = [];
  const auto = createAutoCompare({ delay: 10,
    compare: () => new Promise((resolve, reject) => requests.push({ input, resolve, reject })),
    onResult: result => results.push(result), onError: error => errors.push(error),
  });
  auto.schedule(); auto.schedule(); auto.schedule();
  await until(() => requests.length === 1);
  input = 'middle'; auto.schedule();
  input = 'latest'; auto.schedule();
  await wait(25);
  assert.equal(requests.length, 1);
  requests[0].resolve(requests[0].input);
  await until(() => requests.length === 2);
  assert.deepEqual(results, []);
  assert.equal(requests[1].input, 'latest');
  requests[1].resolve(requests[1].input);
  await until(() => results.length === 1);
  assert.deepEqual(results, ['latest']);
  assert.deepEqual(errors, []);
});

test('旧任务的错误被丢弃，当前错误能显示，随后输入仍能重新对比', async () => {
  const requests = [], errors = [], results = [];
  const auto = createAutoCompare({ delay: 5,
    compare: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
    onResult: value => results.push(value), onError: error => errors.push(error.message),
  });
  auto.schedule(); await until(() => requests.length === 1);
  auto.schedule(); requests[0].reject(new Error('过期错误'));
  await until(() => requests.length === 2);
  requests[1].reject(new Error('当前错误'));
  await until(() => errors.length === 1);
  assert.deepEqual(errors, ['当前错误']);
  auto.schedule(); await until(() => requests.length === 3);
  requests[2].resolve('已恢复');
  await until(() => results.length === 1);
  assert.deepEqual(results, ['已恢复']);
});

test('空白、无效输入与重复字段不会被自动对比报告为一致', () => {
  const cache = new Map();
  assert.equal(compareInputDocuments('{"a":1}', '{"a":2}', {}, cache).counts.changed, 1);
  const blank = compareInputDocuments(' ', '{"a":2}', {}, cache);
  assert.equal(blank.compared, false);
  assert.equal(blank.rows.length, 0);
  assert.equal(cache.has('left'), false);
  const invalid = compareInputDocuments('{', '[', {}, cache);
  assert.equal(invalid.compared, false);
  assert.ok(invalid.errors.left && invalid.errors.right);
  assert.equal(compareInputDocuments('{"a":1,"a":2}', '{}', {}, cache).compared, false);
  const recovered = compareInputDocuments('{"a":1}', '{"a":1}', {}, cache);
  assert.equal(recovered.compared, true);
  assert.equal(recovered.rows.length, 0);
});

test('仅修改数组选项即可产生最新结果，超大整数不丢失', () => {
  const cache = new Map();
  const left = '[9223372036854775807,1]', right = '[1,9223372036854775807]';
  assert.equal(compareInputDocuments(left, right, {}, cache).counts.changed, 2);
  assert.equal(compareInputDocuments(left, right, { ignoreArrayOrder: true }, cache).rows.length, 0);
  assert.equal(compareInputDocuments(left, '[9223372036854775808,1]', {}, cache).counts.changed, 1);
});
