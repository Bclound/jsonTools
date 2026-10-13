import test from 'node:test';
import assert from 'node:assert/strict';
import { rowOffsets, rowAt } from '../src/virtual-list.js';

test('折行结果使用实测高度，未显示的结果保留估计高度', () => {
  const offsets = rowOffsets(5, 72, new Map([[0, 106], [2, 240], [4, 89]]));
  assert.deepEqual([...offsets], [0, 106, 178, 418, 490, 579]);
  for (const [position, row] of [[0, 0], [105, 0], [106, 1], [177, 1], [178, 2], [417, 2], [418, 3], [578, 4], [579, 4], [900, 4]]) {
    assert.equal(rowAt(offsets, position), row);
  }
});

test('两万条结果的末尾和超高行均能正确定位，宽度变化后可重新估计', () => {
  const heights = new Map([[0, 120], [9999, 1200], [19999, 300]]);
  const offsets = rowOffsets(20000, 72, heights);
  assert.equal(rowAt(offsets, offsets[9999] + 1100), 9999);
  assert.equal(rowAt(offsets, offsets[19999]), 19999);
  assert.equal(rowAt(offsets, offsets[20000]), 19999);
  assert.equal(offsets[20000], 20000 * 72 + 48 + 1128 + 228);
  heights.clear();
  assert.equal(rowOffsets(20000, 72, heights)[19999], 19999 * 72);
});

test('空列表和只有一条结果时索引不越界', () => {
  assert.deepEqual([...rowOffsets(0, 72, new Map())], [0]);
  assert.equal(rowAt(new Float64Array([0]), 0), 0);
  assert.equal(rowAt(new Float64Array([0, 72]), -10), 0);
  assert.equal(rowAt(new Float64Array([0, 72]), 100), 0);
});
