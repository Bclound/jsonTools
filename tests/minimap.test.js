import test from 'node:test';
import assert from 'node:assert/strict';
import { minimapWindow, minimapLineAt, overviewLineAt, overviewTargetAt, matchPixels, firstMatchAt } from '../src/minimap-core.js';

test('缩略图窗口限定绘制行数，首屏、中部及末尾均包含代码视口', () => {
  for (const [first, last] of [[1, 25], [60000, 60024], [119978, 120002]]) {
    const window = minimapWindow(120002, first, last, 600);
    assert.equal(window.end - window.start + 1, 200);
    assert.ok(window.start <= first);
    assert.ok(window.end >= last);
    assert.ok(window.thumbTop >= 0);
    assert.ok(window.thumbTop + window.thumbHeight <= 600);
  }
  assert.equal(minimapWindow(120002, 119978, 120002, 600).end, 120002);
});

test('短文档和空文档边界不会产生越界行号，点击对应实际预览行', () => {
  const short = minimapWindow(14, 1, 14, 600);
  assert.deepEqual([short.start, short.end], [1, 14]);
  assert.equal(minimapLineAt(9, short, 14), 4);
  assert.equal(minimapLineAt(-10, short, 14), 1);
  assert.equal(minimapLineAt(700, short, 14), 14);
  const empty = minimapWindow(0, 1, 1, 600);
  assert.deepEqual([empty.start, empty.end], [1, 1]);
  assert.equal(empty.thumbHeight, 18);
});

test('全文导航能抵达首尾；密集搜索命中聚合到屏幕像素并保留末尾', () => {
  assert.equal(overviewLineAt(0, 600, 120002), 1);
  assert.equal(overviewLineAt(599, 600, 120002), 120002);
  assert.equal(overviewLineAt(900, 600, 120002), 120002);
  assert.equal(overviewTargetAt(598, 600, 120002, [119998]), 119998);
  assert.equal(overviewTargetAt(50, 600, 120002, [119998]), overviewLineAt(50, 600, 120002));
  assert.equal(overviewTargetAt(300, 600, 120002, []), overviewLineAt(300, 600, 120002));
  const matches = Array.from({ length: 120002 }, (_, index) => index + 1);
  const pixels = matchPixels(matches, 120002, 600);
  assert.ok(pixels.length <= 600);
  assert.equal(pixels[0], 0);
  assert.equal(pixels.at(-1), 598);
  assert.deepEqual(matchPixels([], 120002, 600), []);
  assert.equal(firstMatchAt([4, 13, 19, 100001], 14), 2);
  assert.equal(firstMatchAt([4, 13, 19, 100001], 100002), 4);
});
