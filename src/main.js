import './style.css';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { foldedRanges, unfoldEffect } from '@codemirror/language';
import { createEditor, linkEditorScroll } from './editor.js';
import { createAutoCompare } from './auto-compare.js';
import { VirtualList } from './virtual-list.js';
import { icon } from './icons.js';
import { createExplorer } from './explorer.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fmt = value => value.toLocaleString('zh-CN');
const bytesLabel = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
const button = (name, text, action, cls = '', title = '') => `<button class="btn ${cls}" data-action="${action}" ${title ? `title="${title}"` : ''}>${icon(name)}<span>${text}</span></button>`;
const iconButton = (name, label, action) => `<button class="icon-btn" data-action="${action}" title="${label}" aria-label="${label}">${icon(name)}</button>`;

$('#app').innerHTML = `
  <header class="app-header">
    <a class="app-brand" href="#editor" data-action="nav-editor" aria-label="JSON 工具">${icon('braces')}<span>JSON</span></a>
    <nav class="tool-tabs" aria-label="工具切换">
      <button class="active" data-action="nav-editor" aria-current="page">编辑器</button>
      <button data-action="nav-diff">对比</button>
    </nav>
    <div class="header-actions"><span>双击代码区格式化</span>${iconButton('keyboard', '快捷键与使用说明', 'help')}</div>
  </header>
  <main class="tool-content">
    <section id="editor-page" aria-label="JSON 编辑器">
      <div class="workbench editor-workbench">
        <div class="toolbar">
          <div class="toolbar-main">${button('format', '格式化', 'format', 'primary', '左键双击代码区，或 ⌘ / Ctrl + Shift + F')}${button('compact', '压缩', 'compact')}${button('check', '校验', 'validate')}<span class="divider"></span><select id="indent" aria-label="缩进空格数"><option value="2">2 空格</option><option value="4">4 空格</option><option value="8">8 空格</option></select></div>
          <div class="toolbar-end">${button('search', '搜索', 'search', '', '搜索字段、值或路径 · ⌘ / Ctrl + F')}<span class="divider"></span>${iconButton('copy', '复制 JSON', 'copy')}${iconButton('download', '下载 JSON', 'download')}${iconButton('trash', '清空 JSON（可撤销）', 'clear')}</div>
        </div>
        <div class="error-banner" id="editor-error" hidden></div>
        <div class="focus-bar"><span class="focus-label">当前位置</span><code id="focus-path" aria-live="polite">$</code><span id="focus-type"></span><button class="icon-btn" id="copy-path" aria-label="复制当前位置路径" title="复制完整路径">${icon('copy')}</button><button class="icon-btn" id="reveal-focus" aria-label="在结构图中定位当前字段" title="在结构图中定位">${icon('tree')}</button></div>
        <div class="editor-body" id="editor-body">
          <div class="code-pane"><div class="editor-host" id="editor-host"></div></div>
          <div id="editor-splitter" class="splitter" role="separator" aria-label="调整代码区域宽度" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="44" tabindex="0"></div>
          <aside class="explorer-pane" aria-label="JSON 结构与搜索">
            <div class="explorer-search"><label class="search-field">${icon('search')}<input id="node-search" placeholder="搜索字段、值或路径" aria-label="搜索字段、值或路径" autocomplete="off" /></label><button class="icon-btn" id="clear-search" aria-label="清空搜索" title="清空搜索">${icon('close')}</button></div>
            <div class="graph-heading"><strong>结构图</strong><code id="graph-path">$</code><button id="graph-up" title="查看上一级" disabled>上一级</button><button id="graph-root" title="返回根节点" disabled>根节点</button></div>
            <div class="graph-area"><div id="graph-canvas" class="graph-canvas" tabindex="0" role="region" aria-label="JSON 结构图，可拖动平移、滚轮缩放"></div><div class="graph-controls"><button class="icon-btn" id="graph-fit" title="适应画布" aria-label="适应画布">${icon('expand')}</button><span class="divider"></span><button class="icon-btn" id="graph-out" title="缩小" aria-label="缩小结构图">−</button><span id="graph-zoom">100%</span><button class="icon-btn" id="graph-in" title="放大" aria-label="放大结构图">+</button><span id="graph-info"></span></div></div>
            <section class="search-results" id="search-results" aria-label="搜索结果" hidden><div class="search-results-heading"><strong>搜索结果 <span id="search-count" role="status"></span></strong><span>Enter 下一项 · Shift + Enter 上一项</span></div><div id="search-list" class="virtual-list"></div></section>
          </aside>
        </div>
        <div class="statusbar"><div class="status-group"><span class="validation-status" id="editor-status">待输入</span><span class="stat-separator"></span><span id="editor-lines"></span><span id="editor-size"></span></div><div class="status-group"><span id="cursor-position">行 1，列 1</span><span class="stat-separator"></span><span>UTF-8</span></div></div>
      </div>
    </section>
    <section id="diff-page" aria-label="JSON 结构对比" hidden>
      <div class="diff-options"><label><input type="checkbox" checked disabled /> 忽略对象字段顺序</label><label title="保留重复项数量，未匹配的元素分别列为新增和删除"><input id="ignore-array" type="checkbox" /> 忽略数组顺序</label></div>
      <div class="diff-editors">${['left', 'right'].map((side, i) => `<div class="diff-document workbench"><div class="document-bar"><strong>${i ? '目标 JSON' : '原始 JSON'}</strong><div class="document-actions">${iconButton('format', `格式化${i ? '目标' : '原始'} JSON`, `format-${side}`)}${iconButton('copy', `复制${i ? '目标' : '原始'} JSON`, `copy-${side}`)}${iconButton('trash', `清空${i ? '目标' : '原始'} JSON（可撤销）`, `clear-${side}`)}</div></div><div class="error-banner" id="${side}-error" hidden></div><div class="editor-host diff-host" id="${side}-host"></div><div class="statusbar"><span class="validation-status" id="${side}-status">待输入</span><span id="${side}-lines"></span></div></div>`).join('')}<button class="swap-button" data-action="swap" title="交换两侧内容" aria-label="交换两侧内容">${icon('swap')}</button></div>
      <div class="diff-result workbench"><div class="result-heading"><div><h2>差异</h2><span id="diff-summary" role="status">等待两侧输入 JSON</span></div><div class="result-actions"><span id="diff-time"></span>${button('download', '导出差异', 'export-diff', 'quiet')}</div></div><div class="diff-result-tools"><div class="filter-tabs" role="tablist" aria-label="差异类型">${[['all', '全部'], ['added', '新增'], ['removed', '删除'], ['changed', '修改']].map(([kind, label]) => `<button class="${kind === 'all' ? 'active' : ''}" data-action="filter-${kind}" role="tab" aria-selected="${kind === 'all'}">${label}<span id="count-${kind}">0</span></button>`).join('')}</div><label class="search-field compact-search">${icon('search')}<input id="diff-search" placeholder="筛选路径" aria-label="筛选差异路径" /></label></div><div class="diff-column-header"><span>变更</span><span>JSON 路径</span><span>原始值</span><span>目标值</span></div><div id="diff-list" class="virtual-list diff-list"></div><div class="diff-result-footer"><span id="diff-filter-info">0 处差异</span><span>点击差异定位代码</span></div></div>
    </section>
  </main>
  <div class="busy-indicator" id="busy" role="status" hidden><span class="spinner"></span><span id="busy-text"></span><button data-action="cancel">取消</button></div>
  <div id="toast" role="status" hidden></div>
  <dialog id="help-dialog"><div class="dialog-title"><h2>快捷键与使用说明</h2>${iconButton('close', '关闭说明', 'close-help')}</div><div class="help-section"><p>直接粘贴 JSON。在任意代码区双击左键，即可格式化当前内容。输入或修改对比选项后，会自动更新差异；两侧滚动条同步。</p><p>对比默认按数组索引匹配。忽略数组顺序时，未匹配项分别显示为删除与新增。大整数保留原始精度，重复字段需先消除歧义才能对比。</p><p>搜索覆盖完整文档，结果显示路径与数组下标。点击结果或图中字段可定位代码；当前位置栏跟随光标更新，可复制路径。结构图支持拖动、缩放，较长对象与数组按组显示。</p><p>关闭或刷新页面会清空内容，需要保留时请复制或下载。</p></div><div class="shortcut-list"><div><span>格式化</span><kbd>双击左键 / ⌘ Ctrl + Shift + F</kbd></div><div><span>搜索字段 / 值 / 路径</span><kbd>⌘ / Ctrl + F</kbd></div><div><span>下载 JSON</span><kbd>⌘ / Ctrl + S</kbd></div><div><span>撤销</span><kbd>⌘ / Ctrl + Z</kbd></div><div><span>切换编辑器 / 对比</span><kbd>Alt + 1 / 2</kbd></div></div></dialog>
`;

const state = { page: 'editor', indent: 2, busy: false, diff: null, filter: 'all', diffQuery: '', diffFresh: false, selectedDiff: null };
const docs = {};
let explorer;
let worker, sequence = 0;
const pending = new Map();
function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const task = pending.get(data.id);
    if (!task) return;
    pending.delete(data.id);
    if (data.error) task.reject(Object.assign(new Error(data.error.message), data.error));
    else task.resolve(data);
  };
  worker.onerror = () => {
    for (const task of pending.values()) task.reject(new Error('后台处理异常，请重试或将文档拆小后再处理'));
    pending.clear();
    worker.terminate();
    for (const doc of Object.values(docs)) doc.synced = -1;
    startWorker();
  };
}
startWorker();
function rpc(operation, options = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, operation, ...options });
  });
}
function toast(message, action) {
  const el = $('#toast');
  clearTimeout(toast.timer);
  el.replaceChildren(document.createTextNode(message));
  if (action) { const button = document.createElement('button'); button.textContent = '撤销'; button.onclick = action; el.append(button); }
  el.hidden = false;
  toast.timer = setTimeout(() => { el.hidden = true; }, 4200);
}
async function task(label, action) {
  if (state.busy) { toast('正在处理上一项操作，可点击下方「取消」'); return; }
  state.busy = true;
  $('#busy-text').textContent = label;
  $('#busy').hidden = false;
  document.body.classList.add('is-busy');
  try { await action(); } catch (error) { toast(error.message); }
  finally {
    state.busy = false; $('#busy').hidden = true; document.body.classList.remove('is-busy');
    if (state.page === 'diff') scheduleComparison();
  }
}
function cancel() {
  worker.terminate();
  for (const task of pending.values()) task.reject(new Error('已取消处理，原始内容已保留'));
  pending.clear();
  for (const doc of Object.values(docs)) doc.synced = -1;
  startWorker();
}
function getText(side) { return docs[side].view.state.doc.toString(); }
function scheduleComparison() {
  state.diffFresh = false;
  queueMicrotask(() => { docs.left.view.setDiff([]); docs.right.view.setDiff([]); });
  $('#diff-summary').textContent = '等待输入完成…';
  $('#diff-summary').classList.add('stale');
  $('#diff-list').classList.add('stale-results');
  $('[data-action="export-diff"]').disabled = true;
  autoCompare.schedule();
}
function setValidation(side, text, kind = '') {
  const el = $(`#${side}-status`);
  el.className = `validation-status ${kind}`;
  el.innerHTML = `${icon(kind === 'valid' ? 'check' : kind === 'invalid' ? 'alert' : 'dot')}${esc(text)}`;
}
function showError(side, error) {
  const el = $(`#${side}-error`);
  el.hidden = false;
  el.innerHTML = `${icon('alert')}<span>${esc(error.message)}${error.line ? ` · 第 ${error.line} 行，第 ${error.column} 列` : ''}</span>${error.offset !== undefined ? '<button>定位错误</button>' : ''}`;
  el.querySelector('button')?.addEventListener('click', () => locate(side, error.offset, 0));
  setValidation(side, '校验未通过', 'invalid');
}
function updateStats(side) {
  const doc = docs[side];
  $(`#${side}-lines`).textContent = `${fmt(doc.view.state.doc.lines)} 行`;
  if (side === 'editor') {
    $('#editor-size').textContent = !doc.view.state.doc.length ? '0 B' : doc.stats && doc.synced === doc.revision ? bytesLabel(doc.stats.bytes) : '待校验';
  }
}
function onChange(side) {
  const doc = docs[side];
  doc.revision++;
  doc.dirty = true;
  doc.stats = null;
  $(`#${side}-error`).hidden = true;
  const length = doc.view.state.doc.length;
  setValidation(side, !length ? '待输入' : '待校验');
  updateStats(side);
  if (side !== 'editor') { scheduleComparison(); return; }
  explorer?.changed();
}
for (const side of ['editor', 'left', 'right']) {
  docs[side] = { revision: 0, synced: -1, dirty: false, filename: side === 'editor' ? 'data.json' : side === 'left' ? 'original.json' : 'target.json' };
  docs[side].view = createEditor($(`#${side}-host`), '', () => onChange(side), view => {
    if (side !== 'editor') return;
    const pos = view.state.selection.main.head, line = view.state.doc.lineAt(pos);
    $('#cursor-position').textContent = `行 ${fmt(line.number)}，列 ${fmt(pos - line.from + 1)}`;
    explorer?.cursor(view);
  }, () => transform('format', side), () => download(side), side === 'editor' ? 'JSON 代码编辑器' : side === 'left' ? '原始 JSON 代码编辑器' : '目标 JSON 代码编辑器', side === 'editor' ? () => explorer?.search() : null);
  updateStats(side);
}
const pauseScrollSync = linkEditorScroll(docs.left.view, docs.right.view);
function setText(side, text) {
  docs[side].view.dispatch({ changes: { from: 0, to: docs[side].view.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
}
async function ensureDoc(side) {
  const doc = docs[side];
  if (doc.synced === doc.revision) return doc.stats;
  const revision = doc.revision;
  try {
    if (doc.loadingRevision !== revision || !doc.loading) {
      doc.loadingRevision = revision;
      doc.loading = rpc('load', { side, text: getText(side) });
    }
    const { result } = await doc.loading;
    if (revision !== doc.revision) throw new Error('内容已更改，请重新执行操作');
    doc.synced = revision;
    doc.stats = result;
    $(`#${side}-error`).hidden = true;
    setValidation(side, result.duplicates ? `存在 ${result.duplicates} 个重复字段` : '校验通过', result.duplicates ? 'warning' : 'valid');
    updateStats(side);
    return result;
  } catch (error) {
    if (revision === doc.revision && error.offset !== undefined) showError(side, error);
    else if (revision === doc.revision && !error.message.startsWith('已取消')) showError(side, error);
    throw error;
  } finally {
    if (doc.loadingRevision === revision) doc.loading = null;
  }
}
function locate(side, offset = 0, length = 0) {
  const view = docs[side].view;
  const from = Math.min(offset, view.state.doc.length);
  const effects = [EditorView.scrollIntoView(from, { y: 'center' })];
  foldedRanges(view.state).between(from, from, (start, end) => effects.push(unfoldEffect.of({ from: start, to: end })));
  view.dispatch({ selection: { anchor: from, head: Math.min(from + length, view.state.doc.length) }, effects });
  view.focus();
}
async function transform(operation, side = 'editor') {
  await task(operation === 'format' ? '正在格式化 JSON…' : '正在压缩 JSON…', async () => {
    await ensureDoc(side);
    const revision = docs[side].revision;
    const { result, elapsed } = await rpc(operation, { side, indent: state.indent });
    if (revision !== docs[side].revision) throw new Error('内容已更改，未覆盖当前文档，请重试');
    if (result !== getText(side)) setText(side, result);
    await ensureDoc(side);
    if (side === 'editor') await explorer.refresh();
    toast(`${operation === 'format' ? '格式化' : '压缩'}完成 · ${Math.round(elapsed)} ms`);
  });
}
explorer = createExplorer({
  rpc, ensureDoc: () => ensureDoc('editor'), getRevision: () => docs.editor.revision,
  isSynced: () => docs.editor.synced === docs.editor.revision,
  getLength: () => docs.editor.view.state.doc.length,
  locate: (offset, length) => locate('editor', offset, length), toast,
});
const splitter = $('#editor-splitter');
function setSplit(percent) {
  const value = Math.max(25, Math.min(75, percent));
  $('#editor-body').style.setProperty('--code-width', `${value}%`);
  splitter.setAttribute('aria-valuenow', String(Math.round(value)));
  docs.editor.view.requestMeasure();
}
splitter.onpointerdown = event => {
  if (event.button !== 0) return;
  splitter.setPointerCapture(event.pointerId);
  splitter.classList.add('dragging');
};
splitter.onpointermove = event => {
  if (!splitter.hasPointerCapture(event.pointerId)) return;
  const rect = $('#editor-body').getBoundingClientRect();
  setSplit((event.clientX - rect.left) / rect.width * 100);
};
splitter.onpointerup = () => splitter.classList.remove('dragging');
splitter.onpointercancel = () => splitter.classList.remove('dragging');
splitter.onkeydown = event => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    setSplit(Number(splitter.getAttribute('aria-valuenow')) + (event.key === 'ArrowLeft' ? -3 : 3));
  }
};
function showPage(page) {
  state.page = page;
  $('#editor-page').hidden = page !== 'editor';
  $('#diff-page').hidden = page !== 'diff';
  for (const item of ['editor', 'diff']) {
    const button = $(`.tool-tabs [data-action="nav-${item}"]`);
    button.classList.toggle('active', item === page);
    if (item === page) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  }
  if (page === 'diff') scheduleComparison();
  history.replaceState(null, '', `#${page}`);
  for (const doc of Object.values(docs)) doc.view.requestMeasure();
}
function saveBlob(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function download(side = 'editor') {
  if (!docs[side].view.state.doc.length) { toast('当前文档为空'); return; }
  saveBlob(getText(side), docs[side].filename);
  docs[side].dirty = false;
  toast('已下载当前文档');
}
async function copy(side = 'editor') {
  try { await navigator.clipboard.writeText(getText(side)); toast('已复制到剪贴板'); }
  catch { toast('浏览器未允许复制，请在编辑器中全选后复制'); }
}
async function compare() {
  if (state.busy) return null;
  $('#diff-summary').textContent = '正在对比…';
  return rpc('compare-input', {
    left: getText('left'), right: getText('right'), ignoreArrayOrder: $('#ignore-array').checked,
  });
}
function showComparison({ result, elapsed }) {
  state.diff = result.compared ? result : null;
  state.diffFresh = result.compared;
  state.selectedDiff = null;
  for (const side of ['left', 'right']) {
    $(`#${side}-error`).hidden = true;
    if (result.errors[side]) showError(side, result.errors[side]);
    else if (result.meta[side]) {
      const duplicates = result.meta[side].duplicates;
      setValidation(side, duplicates ? `存在 ${duplicates} 个重复字段` : '校验通过', duplicates ? 'warning' : 'valid');
    } else setValidation(side, '待输入');
    docs[side].view.setDiff(result.rows.filter(row => row[`${side}Offset`] !== undefined).map(row => ({
      from: row[`${side}Offset`], to: row[`${side}Offset`] + row[`${side}Length`] - 1,
      kind: side === 'left' ? 'removed' : 'added',
    })));
  }
  $('#diff-summary').classList.remove('stale');
  $('#diff-list').classList.remove('stale-results');
  $('#diff-summary').textContent = result.message || (result.rows.length ? `${fmt(result.rows.length)} 处差异` : '两份 JSON 一致');
  $('#diff-time').textContent = result.compared ? `${Math.round(elapsed)} ms` : '';
  $('[data-action="export-diff"]').disabled = !result.compared;
  for (const kind of ['all', 'added', 'removed', 'changed']) $(`#count-${kind}`).textContent = fmt(kind === 'all' ? result.rows.length : result.counts[kind]);
  filterDiff();
}
const kindLabels = { added: '新增', removed: '删除', changed: '修改' };
const diffList = new VirtualList($('#diff-list'), { rowHeight: 44, emptyText: '', renderRow: row => {
  const el = document.createElement('button');
  el.className = `diff-row ${row.kind}${state.selectedDiff === row ? ' selected' : ''}`;
  el.title = `${row.path}\n原始值：${row.before || '不存在'}\n目标值：${row.after || '不存在'}`;
  el.innerHTML = `<span class="change-badge ${row.kind}">${row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : '~'} ${kindLabels[row.kind]}</span><span class="diff-path">${esc(row.path)}</span><span class="diff-before">${esc(row.before || '—')}</span><span class="diff-after">${esc(row.after || '—')}</span>`;
  el.onclick = () => {
    if (!state.diffFresh) return;
    state.selectedDiff = row;
    pauseScrollSync();
    if (row.leftOffset !== undefined) locate('left', row.leftOffset, row.leftLength);
    if (row.rightOffset !== undefined) locate('right', row.rightOffset, row.rightLength);
    diffList.render();
  };
  return el;
} });
diffList.setRows([]);
function filterDiff() {
  const rows = (state.diff?.rows || []).filter(row => (state.filter === 'all' || state.filter === row.kind) && row.path.toLocaleLowerCase().includes(state.diffQuery.toLocaleLowerCase()));
  diffList.emptyText = !state.diff ? '' : !state.diff.rows.length ? '无差异' : '没有符合筛选条件的差异';
  diffList.setRows(rows, true);
  $('#diff-filter-info').textContent = state.diff ? `显示 ${fmt(rows.length)} / ${fmt(state.diff.rows.length)} 处差异` : '0 处差异';
  for (const kind of ['all', 'added', 'removed', 'changed']) {
    const tab = $(`[data-action="filter-${kind}"]`);
    tab.classList.toggle('active', state.filter === kind); tab.setAttribute('aria-selected', String(state.filter === kind));
  }
}
function exportDiff() {
  if (!state.diff || !state.diffFresh) { toast('正在等待有效的对比结果'); return; }
  const left = getText('left'), right = getText('right');
  const report = { options: { ignoreObjectKeyOrder: true, ignoreArrayOrder: $('#ignore-array').checked }, counts: state.diff.counts,
    differences: state.diff.rows.map(row => ({ type: row.kind, path: row.path,
      beforeJSON: row.leftOffset === undefined ? null : left.slice(row.leftOffset, row.leftOffset + row.leftLength),
      afterJSON: row.rightOffset === undefined ? null : right.slice(row.rightOffset, row.rightOffset + row.rightLength) })) };
  saveBlob(JSON.stringify(report, null, 2), 'json-diff.json'); toast('已导出完整差异报告，数值以 JSON 原文保留');
}
const autoCompare = createAutoCompare({
  compare,
  onResult: showComparison,
  onError(error) {
    showComparison({ result: { compared: false, rows: [], counts: { added: 0, removed: 0, changed: 0 }, errors: {}, meta: {}, message: error.message }, elapsed: 0 });
  },
});
$('[data-action="export-diff"]').disabled = true;
function clearDocument(side = 'editor') {
  setText(side, '');
  toast('已清空', () => undo(docs[side].view));
  docs[side].view.focus();
}
const actions = {
  'nav-editor': () => showPage('editor'), 'nav-diff': () => showPage('diff'),
  search: () => explorer.search(),
  format: () => transform('format'), compact: () => transform('compact'),
  validate: () => task('正在校验 JSON…', async () => { await ensureDoc('editor'); await explorer.refresh(); toast('校验完成'); }),
  download: () => download(), copy: () => copy(),
  clear: () => clearDocument(),
  help: () => $('#help-dialog').showModal(), 'close-help': () => $('#help-dialog').close(), cancel,
  'export-diff': exportDiff,
  swap: () => { const left = getText('left'); setText('left', getText('right')); setText('right', left); },
};
for (const side of ['left', 'right']) {
  actions[`clear-${side}`] = () => clearDocument(side);
  actions[`format-${side}`] = () => transform('format', side);
  actions[`copy-${side}`] = () => copy(side);
}
for (const kind of ['all', 'added', 'removed', 'changed']) actions[`filter-${kind}`] = () => { state.filter = kind; filterDiff(); };
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action && actions[action]) actions[action]();
});
$('#indent').onchange = event => { state.indent = Number(event.target.value); for (const doc of Object.values(docs)) doc.view.setIndent(state.indent); };
$('#diff-search').oninput = event => { state.diffQuery = event.target.value; filterDiff(); };
$('#ignore-array').onchange = scheduleComparison;
$('#help-dialog').addEventListener('click', event => { if (event.target === $('#help-dialog')) $('#help-dialog').close(); });
window.addEventListener('beforeunload', event => { if (Object.values(docs).some(doc => doc.dirty)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => {
  if (event.altKey && ['1', '2'].includes(event.key)) { event.preventDefault(); showPage(event.key === '1' ? 'editor' : 'diff'); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.defaultPrevented) { event.preventDefault(); download(state.page === 'editor' ? 'editor' : 'left'); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && state.page === 'editor') { event.preventDefault(); explorer.search(); }
});
window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (event.dataTransfer.files.length) event.preventDefault(); });
if (location.hash === '#diff') showPage('diff');
