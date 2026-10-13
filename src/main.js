import './style.css';
import { EditorView } from '@codemirror/view';
import { undo } from '@codemirror/commands';
import { createEditor } from './editor.js';
import { VirtualList } from './virtual-list.js';
import { icon } from './icons.js';
import { sample, targetSample } from './sample.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fmt = value => value.toLocaleString('zh-CN');
const bytesLabel = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
const button = (name, text, action, cls = '', title = '') => `<button class="btn ${cls}" data-action="${action}" ${title ? `title="${title}"` : ''}>${icon(name)}<span>${text}</span></button>`;
const iconButton = (name, label, action) => `<button class="icon-btn" data-action="${action}" title="${label}" aria-label="${label}">${icon(name)}</button>`;

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="#editor" data-action="nav-editor" aria-label="JSON 工作台首页"><span class="brand-mark">${icon('braces')}</span><span>JSON<span class="brand-light"> 工作台</span><small>让数据，井然有序。</small></span></a>
    <div class="nav-label">工作空间</div>
    <nav aria-label="工具导航">
      <button class="nav-item active" data-action="nav-editor" aria-label="JSON 编辑器">${icon('braces')}<span>JSON 编辑器</span><kbd>1</kbd></button>
      <button class="nav-item" data-action="nav-diff" aria-label="JSON 对比">${icon('diff')}<span>JSON 对比</span><kbd>2</kbd></button>
    </nav>
    <div class="sidebar-rule"></div>
    <div class="nav-label">随手工具</div>
    <button class="nav-item subtle" data-action="new">${icon('plus')}<span>新建文档</span></button>
    <button class="nav-item subtle" data-action="help">${icon('keyboard')}<span>使用与快捷键</span></button>
    <div class="sidebar-bottom">
      <div class="local-note">${icon('shield')}<strong>数据只属于你</strong><p>所有操作均在浏览器内完成<br>无上传，无广告，无打扰。</p><span><i></i> 本地处理</span></div>
      <div class="sidebar-version">为专注而生<span>v1.0</span></div>
    </div>
  </aside>
  <main>
    <header class="topbar"><div class="breadcrumb">工作空间 ${icon('chevron')} <span id="crumb">JSON 编辑器</span></div><span class="privacy-badge">${icon('lock')} 数据不离开浏览器</span></header>
    <div class="workspace">
      <div class="page-heading"><div><div class="eyebrow">YOUR EVERYDAY JSON TOOL</div><h1 id="page-title">把数据看清楚<span class="title-dot">.</span></h1><p id="page-description">格式化、校验与探索，让复杂的 JSON 一目了然。</p></div><div class="heading-actions">${button('file', '载入示例', 'sample', 'quiet')}${button('upload', '导入 JSON', 'import', 'primary')}</div></div>
      <section id="editor-page" aria-label="JSON 编辑器">
        <div class="workbench">
          <div class="document-bar"><div class="document-name">${icon('file')}<span id="editor-filename">example.json</span><span class="document-tag" id="editor-badge">示例</span></div><div class="document-actions">${iconButton('copy', '复制 JSON', 'copy')}${iconButton('download', '下载 JSON（⌘ / Ctrl + S）', 'download')}<span class="divider"></span>${iconButton('trash', '清空文档（可撤销）', 'clear')}</div></div>
          <div class="toolbar"><div class="toolbar-main">${button('format', '格式化', 'format', '', '⌘ / Ctrl + Shift + F')}${button('compact', '压缩', 'compact')}${button('check', '校验', 'validate')}<span class="divider"></span><label class="indent-label"><select id="indent" aria-label="缩进空格数"><option value="2">2 空格</option><option value="4">4 空格</option><option value="8">8 空格</option></select></label></div><div class="view-tabs" role="tablist" aria-label="JSON 视图"><button class="active" id="code-tab" role="tab" aria-selected="true" data-action="view-code">${icon('code')}代码</button><button id="tree-tab" role="tab" aria-selected="false" data-action="view-tree">${icon('tree')}树形</button></div></div>
          <div class="error-banner" id="editor-error" hidden></div>
          <div class="editor-body" id="editor-body"><div class="code-pane"><div class="editor-host" id="editor-host"></div><div class="editor-empty" hidden><div class="empty-mark">{ }</div><strong>从一段 JSON 开始</strong><p>粘贴内容到这里，或拖入一个 .json 文件</p>${button('upload', '选择文件', 'import')}</div></div><aside class="outline"><div class="outline-header"><span>结构预览</span>${iconButton('expand', '切换完整树形视图', 'view-tree')}</div><div class="outline-caption">快速浏览数据的层次</div><div id="outline-list" class="virtual-list outline-list"></div><div class="outline-footer" id="outline-footer">${icon('tree')} 对象 · 根节点</div></aside></div>
          <div class="full-tree" id="full-tree" hidden><div class="tree-toolbar"><label class="search-field">${icon('search')}<input id="tree-search" placeholder="搜索字段、值或 JSON 路径…" aria-label="搜索树形节点" /><kbd>⌕</kbd></label><div>${button('expand', '全部展开', 'expand-tree', 'quiet')}${button('fold', '收起', 'collapse-tree', 'quiet')}</div></div><div class="tree-column-header"><span>字段 / 路径</span><span>值</span><span>类型</span></div><div id="tree-list" class="virtual-list tree-list"></div><div class="tree-results" id="tree-results"></div></div>
          <div class="statusbar"><div class="status-group"><span class="validation-status" id="editor-status">正在校验…</span><span class="stat-separator"></span><span id="editor-lines"></span><span id="editor-size"></span></div><div class="status-group"><span id="cursor-position">行 1，列 1</span><span class="stat-separator"></span><span>UTF-8</span><span class="json-label">JSON</span></div></div>
        </div>
        <div class="under-workbench"><span>${icon('keyboard')}<kbd>⌘ / Ctrl</kbd> + <kbd>F</kbd> 查找与替换<span class="tip-divider">·</span><kbd>⌘ / Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>F</kbd> 格式化</span><button class="text-button" data-action="help">使用指南 ${icon('arrow')}</button></div>
      </section>
      <section id="diff-page" aria-label="JSON 结构对比" hidden>
        <div class="diff-options"><div><label><input type="checkbox" checked disabled /> 忽略对象字段顺序</label><label title="将数组作为保留重复项的集合比较，未匹配的元素分别列为新增和删除"><input id="ignore-array" type="checkbox" /> 忽略数组顺序</label></div>${button('diff', '开始对比', 'compare', 'primary')}</div>
        <div class="diff-editors">${['left', 'right'].map((side, i) => `<div class="diff-document workbench" data-side="${side}"><div class="document-bar"><div class="document-name"><span class="side-label">${i ? 'B' : 'A'}</span><strong>${i ? '目标 JSON' : '原始 JSON'}</strong><span class="diff-filename" id="${side}-filename">${i ? 'target.json' : 'original.json'}</span></div><div class="document-actions">${iconButton('upload', `导入${i ? '目标' : '原始'} JSON`, `import-${side}`)}${iconButton('format', `格式化${i ? '目标' : '原始'} JSON`, `format-${side}`)}${iconButton('copy', `复制${i ? '目标' : '原始'} JSON`, `copy-${side}`)}</div></div><div class="error-banner" id="${side}-error" hidden></div><div class="editor-host diff-host" id="${side}-host"></div><div class="statusbar"><span class="validation-status" id="${side}-status">待校验</span><span id="${side}-lines"></span></div></div>`).join('')}<button class="swap-button" data-action="swap" title="交换两侧内容" aria-label="交换两侧内容">${icon('swap')}</button></div>
        <div class="diff-result workbench"><div class="result-heading"><div><h2>对比结果</h2><span id="diff-summary">点击「开始对比」，找出数据之间的不同</span></div><div class="result-actions"><span id="diff-time"></span>${button('download', '导出差异', 'export-diff', 'quiet')}</div></div><div class="diff-result-tools"><div class="filter-tabs" role="tablist" aria-label="差异类型">${[['all', '全部'], ['added', '新增'], ['removed', '删除'], ['changed', '修改']].map(([kind, label]) => `<button class="${kind === 'all' ? 'active' : ''}" data-action="filter-${kind}" role="tab" aria-selected="${kind === 'all'}">${label}<span id="count-${kind}">0</span></button>`).join('')}</div><label class="search-field compact-search">${icon('search')}<input id="diff-search" placeholder="筛选 JSON 路径…" aria-label="筛选差异路径" /></label></div><div class="diff-column-header"><span>变更</span><span>JSON 路径</span><span>原始值</span><span>目标值</span></div><div id="diff-list" class="virtual-list diff-list"></div><div class="diff-result-footer"><span id="diff-filter-info">结构化比较 · 忽略空格、缩进与对象字段顺序</span><span>点击差异定位到对应代码</span></div></div>
      </section>
      <footer class="page-footer"><span>少一点干扰，多一点清晰。</span><span>${icon('shield')} 纯前端 · 无数据上传</span></footer>
    </div>
  </main>
  <input id="file-input" type="file" accept=".json,.txt,application/json,text/plain" hidden />
  <div class="busy-indicator" id="busy" role="status" hidden><span class="spinner"></span><span id="busy-text"></span><button data-action="cancel">取消</button></div>
  <div id="toast" role="status" hidden></div>
  <dialog id="help-dialog"><div class="dialog-title"><h2>留给数据的安静空间</h2>${iconButton('close', '关闭指南', 'close-help')}</div><p class="dialog-description">所有内容只在当前页面内处理。关闭或刷新页面会清空文档，请及时下载保存。</p><div class="help-section"><h3>随手就能用</h3><p>粘贴 JSON，或拖入文件。格式化、压缩均保留大整数原文。树形视图可搜索字段、值和路径；双击节点可回到代码。</p><p>对比默认按数组索引匹配；忽略数组顺序后，保留重复项数量，并将未匹配的元素显示为新增或删除。点击差异可定位两侧代码。</p><p>大文件使用可视区域渲染与后台计算。超过 250 KB 后，请按需点击校验或打开树形视图；单文件上限 50 MB，嵌套上限 512 层。</p></div><div class="shortcut-list"><div><span>查找 / 替换</span><kbd>⌘ / Ctrl + F</kbd></div><div><span>格式化当前文档</span><kbd>⌘ / Ctrl + Shift + F</kbd></div><div><span>下载当前文档</span><kbd>⌘ / Ctrl + S</kbd></div><div><span>撤销操作</span><kbd>⌘ / Ctrl + Z</kbd></div><div><span>切换编辑 / 对比</span><kbd>Alt + 1 / 2</kbd></div></div><button class="btn primary dialog-done" data-action="close-help">开始整理</button></dialog>
`;

const state = { page: 'editor', view: 'code', indent: 2, busy: false, treeExpanded: new Set([0]), treeAll: false, treeQuery: '', diff: null, filter: 'all', diffQuery: '', diffFresh: false, selectedDiff: null };
const docs = {};
let worker, sequence = 0, cancellation = 0;
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
  finally { state.busy = false; $('#busy').hidden = true; document.body.classList.remove('is-busy'); }
}
function cancel() {
  cancellation++;
  worker.terminate();
  for (const task of pending.values()) task.reject(new Error('已取消处理，原始内容已保留'));
  pending.clear();
  for (const doc of Object.values(docs)) doc.synced = -1;
  startWorker();
}
function getText(side) { return docs[side].view.state.doc.toString(); }
function staleDiff() {
  if (!state.diff) return;
  state.diffFresh = false;
  queueMicrotask(() => { docs.left.view.setDiff([]); docs.right.view.setDiff([]); });
  $('#diff-summary').textContent = '内容或选项已更改，请重新对比';
  $('#diff-summary').classList.add('stale');
  $('#diff-list').classList.add('stale-results');
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
    $('#editor-size').textContent = doc.stats && doc.synced === doc.revision ? bytesLabel(doc.stats.bytes) : '待校验';
    $('.editor-empty').hidden = doc.view.state.doc.length !== 0;
  }
}
function onChange(side) {
  const doc = docs[side];
  doc.revision++;
  doc.dirty = true;
  doc.stats = null;
  $(`#${side}-error`).hidden = true;
  setValidation(side, doc.view.state.doc.length > 250000 ? '大文档 · 按需校验' : '待校验');
  updateStats(side);
  if (side === 'editor') {
    $('#editor-badge').textContent = '未导出';
    $('#editor-badge').classList.add('unsaved');
    $('#outline-footer').textContent = '内容已更改，等待更新';
    $('#outline-list').classList.add('stale-results');
    $('#tree-list').classList.add('stale-results');
  } else staleDiff();
  clearTimeout(doc.timer);
  if (doc.view.state.doc.length && doc.view.state.doc.length <= 250000) {
    doc.timer = setTimeout(() => {
      if (state.busy) return;
      ensureDoc(side).then(() => side === 'editor' ? refreshTree() : null).catch(() => {});
    }, 650);
  }
}
for (const [side, content] of [['editor', sample], ['left', sample], ['right', targetSample]]) {
  docs[side] = { revision: 0, synced: -1, dirty: false, filename: side === 'editor' ? 'example.json' : side === 'left' ? 'original.json' : 'target.json' };
  docs[side].view = createEditor($(`#${side}-host`), content, () => onChange(side), view => {
    if (side !== 'editor') return;
    const pos = view.state.selection.main.head, line = view.state.doc.lineAt(pos);
    $('#cursor-position').textContent = `行 ${fmt(line.number)}，列 ${fmt(pos - line.from + 1)}`;
  }, () => transform('format', side), () => download(side), side === 'editor' ? 'JSON 代码编辑器' : side === 'left' ? '原始 JSON 代码编辑器' : '目标 JSON 代码编辑器');
  updateStats(side);
}
function setText(side, text, filename) {
  if (filename) {
    docs[side].filename = filename;
    $(`#${side}-filename`).textContent = filename;
  }
  docs[side].view.dispatch({ changes: { from: 0, to: docs[side].view.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
  if (side === 'editor') { state.treeExpanded = new Set([0]); state.treeAll = false; state.treeQuery = ''; $('#tree-search').value = ''; }
}
async function ensureDoc(side) {
  const doc = docs[side];
  if (doc.synced === doc.revision) return doc.stats;
  const revision = doc.revision;
  try {
    const { result } = await rpc('load', { side, text: getText(side) });
    if (revision !== doc.revision) throw new Error('内容已更改，请重新执行操作');
    doc.synced = revision;
    doc.stats = result;
    if (side === 'editor') state.treeExpanded.add(result.rootOffset);
    $(`#${side}-error`).hidden = true;
    setValidation(side, result.duplicates ? `存在 ${result.duplicates} 个重复字段` : '校验通过', result.duplicates ? 'warning' : 'valid');
    updateStats(side);
    return result;
  } catch (error) {
    if (revision === doc.revision && error.offset !== undefined) showError(side, error);
    else if (revision === doc.revision && !error.message.startsWith('已取消')) showError(side, error);
    throw error;
  }
}
function locate(side, offset = 0, length = 0) {
  const view = docs[side].view;
  const from = Math.min(offset, view.state.doc.length);
  view.dispatch({ selection: { anchor: from, head: Math.min(from + length, view.state.doc.length) }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
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
    if (side === 'editor') await refreshTree();
    toast(`${operation === 'format' ? '格式化' : '压缩'}完成 · ${Math.round(elapsed)} ms`);
  });
}
function treeRow(row, compact = false) {
  const el = document.createElement('div');
  el.className = `tree-row ${compact ? 'compact' : ''}`;
  el.setAttribute('role', 'treeitem');
  el.setAttribute('aria-level', String(row.depth + 1));
  if (row.count) el.setAttribute('aria-expanded', String(row.open));
  el.tabIndex = 0;
  const container = row.type === 'object' || row.type === 'array';
  el.title = `${row.path}\n${row.value}`;
  const key = typeof row.key === 'number' ? `[${row.key}]` : row.key;
  el.innerHTML = `<span class="tree-key" style="padding-left:${Math.min(row.depth, compact ? 8 : 30) * (compact ? 15 : 20) + 12}px"><span class="tree-chevron ${row.open ? 'open' : ''}">${row.count ? icon('chevron') : '<span class="leaf-dot"></span>'}</span><span>${esc(key)}</span>${compact && container ? `<small>${row.count}</small>` : ''}</span>${compact ? (!container ? `<span class="tree-mini-value type-${row.type}">${esc(row.value)}</span>` : '') : `<span class="tree-value type-${row.type}">${esc(row.value)}</span><span class="tree-type">${row.type}</span>`}`;
  const activate = () => {
    if ($('#tree-list').classList.contains('stale-results')) { toast('内容已更改，请重新打开树形视图更新'); return; }
    if (row.count) toggleTree(row);
    else { showView('code'); locate('editor', row.offset, row.length); }
  };
  el.onclick = activate;
  el.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } };
  el.ondblclick = () => { if (docs.editor.synced === docs.editor.revision) { showView('code'); locate('editor', row.offset, row.length); } };
  return el;
}
const outlineList = new VirtualList($('#outline-list'), { rowHeight: 32, renderRow: row => treeRow(row, true), emptyText: '有效 JSON 的结构会显示在这里' });
const treeList = new VirtualList($('#tree-list'), { rowHeight: 36, renderRow: row => treeRow(row), emptyText: '没有匹配的字段、值或路径' });
$('#outline-list').setAttribute('role', 'tree');
$('#tree-list').setAttribute('role', 'tree');
let treeRequest = 0;
async function refreshTree() {
  const request = ++treeRequest;
  await ensureDoc('editor');
  const revision = docs.editor.revision;
  const { result } = await rpc('tree', { side: 'editor', expanded: state.treeAll ? 'all' : [...state.treeExpanded], query: state.treeQuery });
  if (request !== treeRequest || revision !== docs.editor.revision) return;
  treeList.setRows(result);
  outlineList.setRows(result);
  $('#tree-list').classList.remove('stale-results');
  $('#outline-list').classList.remove('stale-results');
  $('#outline-footer').innerHTML = `${icon('tree')} ${fmt(docs.editor.stats.nodes)} 个节点 · 点击展开`;
  $('#tree-results').textContent = `${fmt(result.length)} 个可见节点${state.treeQuery ? ' · 搜索结果包含完整路径（悬停查看）' : ' · 双击节点可定位到代码'}`;
}
function toggleTree(row) {
  if (state.treeQuery) { toast('搜索时自动展开匹配项；清空搜索后可折叠'); return; }
  if (state.treeAll) { state.treeExpanded = new Set(treeList.rows.filter(r => r.count).map(r => r.offset)); state.treeAll = false; }
  if (state.treeExpanded.has(row.offset)) state.treeExpanded.delete(row.offset); else state.treeExpanded.add(row.offset);
  refreshTree().catch(error => toast(error.message));
}
function showView(view) {
  state.view = view;
  $('#editor-body').hidden = view !== 'code';
  $('#full-tree').hidden = view !== 'tree';
  for (const type of ['code', 'tree']) { $(`#${type}-tab`).classList.toggle('active', type === view); $(`#${type}-tab`).setAttribute('aria-selected', String(type === view)); }
  if (view === 'tree') task('正在生成树形视图…', refreshTree);
  else docs.editor.view.requestMeasure();
}
function showPage(page) {
  state.page = page;
  $('#editor-page').hidden = page !== 'editor';
  $('#diff-page').hidden = page !== 'diff';
  $('.nav-item[data-action="nav-editor"]').classList.toggle('active', page === 'editor');
  $('.nav-item[data-action="nav-diff"]').classList.toggle('active', page === 'diff');
  $('#crumb').textContent = page === 'editor' ? 'JSON 编辑器' : 'JSON 对比';
  $('#page-title').innerHTML = page === 'editor' ? '把数据看清楚<span class="title-dot">.</span>' : '每一处变化，都有迹可循<span class="title-dot">.</span>';
  $('#page-description').textContent = page === 'editor' ? '格式化、校验与探索，让复杂的 JSON 一目了然。' : '深入数据结构，准确找到新增、删除和修改。';
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
  if (side === 'editor') { $('#editor-badge').textContent = '已导出'; $('#editor-badge').classList.remove('unsaved'); }
  toast('已下载当前文档');
}
async function copy(side = 'editor') {
  try { await navigator.clipboard.writeText(getText(side)); toast('已复制到剪贴板'); }
  catch { toast('浏览器未允许复制，请在编辑器中全选后复制'); }
}
let importSide = 'editor';
function chooseFile(side = state.page === 'editor' ? 'editor' : 'left') { importSide = side; $('#file-input').click(); }
async function importFile(file, side) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { toast('单文件上限为 50 MB，请拆分后导入'); return; }
  await task('正在读取文件…', async () => {
    const revision = docs[side].revision;
    const operation = cancellation;
    const text = (await file.text()).replace(/^\uFEFF/, '');
    if (operation !== cancellation) throw new Error('已取消读取，原始内容已保留');
    if (revision !== docs[side].revision) throw new Error('内容已更改，未覆盖当前文档，请重新导入');
    setText(side, text, file.name);
    docs[side].dirty = false;
    if (side === 'editor') { $('#editor-badge').textContent = '本地文件'; $('#editor-badge').classList.remove('unsaved'); }
    try { await ensureDoc(side); if (side === 'editor') await refreshTree(); }
    catch (error) { toast(`文件已导入 · ${error.message}`); return; }
    toast(`已导入 ${file.name} · ${bytesLabel(file.size)}`);
  });
}
$('#file-input').onchange = event => { importFile(event.target.files[0], importSide); event.target.value = ''; };
for (const side of ['editor', 'left', 'right']) {
  const el = side === 'editor' ? $('#editor-page .workbench') : $(`.diff-document[data-side="${side}"]`);
  el.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); el.classList.add('drag-over'); } });
  el.addEventListener('dragleave', event => { if (!el.contains(event.relatedTarget)) el.classList.remove('drag-over'); });
  el.addEventListener('drop', event => { if (event.dataTransfer.files.length) { event.preventDefault(); event.stopPropagation(); el.classList.remove('drag-over'); importFile(event.dataTransfer.files[0], side); } }, true);
}
async function compare() {
  await task('正在比较 JSON 结构…', async () => {
    await ensureDoc('left'); await ensureDoc('right');
    const revisions = [docs.left.revision, docs.right.revision];
    const ignoreArrayOrder = $('#ignore-array').checked;
    const { result, elapsed } = await rpc('compare', { ignoreArrayOrder });
    if (docs.left.revision !== revisions[0] || docs.right.revision !== revisions[1] || ignoreArrayOrder !== $('#ignore-array').checked) throw new Error('内容或选项已更改，请重新对比');
    state.diff = result; state.diffFresh = true; state.selectedDiff = null;
    for (const side of ['left', 'right']) {
      docs[side].view.setDiff(result.rows.filter(row => row[`${side}Offset`] !== undefined).map(row => ({
        from: row[`${side}Offset`], to: row[`${side}Offset`] + row[`${side}Length`] - 1,
        kind: side === 'left' ? 'removed' : 'added',
      })));
    }
    $('#diff-summary').classList.remove('stale'); $('#diff-list').classList.remove('stale-results');
    $('#diff-summary').textContent = result.rows.length ? `发现 ${fmt(result.rows.length)} 处差异` : '两份 JSON 的数据结构和值完全一致';
    $('#diff-time').innerHTML = `${icon('clock')} ${Math.round(elapsed)} ms`;
    for (const kind of ['all', 'added', 'removed', 'changed']) $(`#count-${kind}`).textContent = fmt(kind === 'all' ? result.rows.length : result.counts[kind]);
    filterDiff();
  });
}
const kindLabels = { added: '新增', removed: '删除', changed: '修改' };
const diffList = new VirtualList($('#diff-list'), { rowHeight: 44, emptyText: '两份数据，放在一起看。', renderRow: row => {
  const el = document.createElement('button');
  el.className = `diff-row ${row.kind}${state.selectedDiff === row ? ' selected' : ''}`;
  el.title = `${row.path}\n原始值：${row.before || '不存在'}\n目标值：${row.after || '不存在'}`;
  el.innerHTML = `<span class="change-badge ${row.kind}">${row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : '~'} ${kindLabels[row.kind]}</span><span class="diff-path">${esc(row.path)}</span><span class="diff-before">${esc(row.before || '—')}</span><span class="diff-after">${esc(row.after || '—')}</span>`;
  el.onclick = () => {
    if (!state.diffFresh) { toast('请重新对比后再定位'); return; }
    state.selectedDiff = row;
    if (row.leftOffset !== undefined) locate('left', row.leftOffset, row.leftLength);
    if (row.rightOffset !== undefined) locate('right', row.rightOffset, row.rightLength);
    diffList.render();
  };
  return el;
} });
diffList.setRows([]);
function filterDiff() {
  const rows = (state.diff?.rows || []).filter(row => (state.filter === 'all' || state.filter === row.kind) && row.path.toLocaleLowerCase().includes(state.diffQuery.toLocaleLowerCase()));
  diffList.emptyText = !state.diff ? '两份数据，放在一起看。' : !state.diff.rows.length ? '没有差异，一切井然有序。' : '没有符合筛选条件的差异';
  diffList.setRows(rows, true);
  if (state.diff) $('#diff-filter-info').textContent = `显示 ${fmt(rows.length)} / ${fmt(state.diff.rows.length)} 处差异`;
  for (const kind of ['all', 'added', 'removed', 'changed']) {
    const tab = $(`[data-action="filter-${kind}"]`);
    tab.classList.toggle('active', state.filter === kind); tab.setAttribute('aria-selected', String(state.filter === kind));
  }
}
function exportDiff() {
  if (!state.diff || !state.diffFresh) { toast('请先完成对比后再导出'); return; }
  const left = getText('left'), right = getText('right');
  const report = { options: { ignoreObjectKeyOrder: true, ignoreArrayOrder: $('#ignore-array').checked }, counts: state.diff.counts,
    differences: state.diff.rows.map(row => ({ type: row.kind, path: row.path,
      beforeJSON: row.leftOffset === undefined ? null : left.slice(row.leftOffset, row.leftOffset + row.leftLength),
      afterJSON: row.rightOffset === undefined ? null : right.slice(row.rightOffset, row.rightOffset + row.rightLength) })) };
  saveBlob(JSON.stringify(report, null, 2), 'json-diff.json'); toast('已导出完整差异报告，数值以 JSON 原文保留');
}
function loadSample() {
  if (state.page === 'editor') {
    setText('editor', sample, 'example.json');
    toast('已载入示例，原内容可通过撤销恢复', () => undo(docs.editor.view));
  } else {
    setText('left', sample, 'original.json'); setText('right', targetSample, 'target.json'); compare();
  }
}
const actions = {
  'nav-editor': () => showPage('editor'), 'nav-diff': () => showPage('diff'),
  'view-code': () => showView('code'), 'view-tree': () => showView('tree'),
  format: () => transform('format'), compact: () => transform('compact'),
  validate: () => task('正在校验 JSON…', async () => { await ensureDoc('editor'); await refreshTree(); toast('校验完成'); }),
  import: () => chooseFile(), sample: loadSample, download: () => download(), copy: () => copy(),
  clear: () => { setText('editor', ''); outlineList.setRows([]); treeList.setRows([]); toast('已清空文档', () => undo(docs.editor.view)); docs.editor.view.focus(); },
  new: () => { showPage('editor'); showView('code'); setText('editor', '', 'untitled.json'); outlineList.setRows([]); treeList.setRows([]); docs.editor.view.focus(); toast('新文档已就绪，原内容可撤销恢复', () => undo(docs.editor.view)); },
  help: () => $('#help-dialog').showModal(), 'close-help': () => $('#help-dialog').close(), cancel,
  'expand-tree': () => { state.treeAll = true; task('正在展开树形节点…', refreshTree); },
  'collapse-tree': () => { state.treeAll = false; state.treeExpanded = new Set([docs.editor.stats?.rootOffset || 0]); task('正在更新树形视图…', refreshTree); },
  compare, 'export-diff': exportDiff,
  swap: () => { const a = getText('left'), name = docs.left.filename; setText('left', getText('right'), docs.right.filename); setText('right', a, name); toast('已交换原始与目标 JSON'); },
};
for (const side of ['left', 'right']) {
  actions[`import-${side}`] = () => chooseFile(side);
  actions[`format-${side}`] = () => transform('format', side);
  actions[`copy-${side}`] = () => copy(side);
}
for (const kind of ['all', 'added', 'removed', 'changed']) actions[`filter-${kind}`] = () => { state.filter = kind; filterDiff(); };
document.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action && actions[action]) actions[action]();
});
$('#indent').onchange = event => { state.indent = Number(event.target.value); for (const doc of Object.values(docs)) doc.view.setIndent(state.indent); };
let treeTimer;
$('#tree-search').oninput = event => { state.treeQuery = event.target.value; clearTimeout(treeTimer); treeTimer = setTimeout(() => refreshTree().catch(error => toast(error.message)), 200); };
$('#diff-search').oninput = event => { state.diffQuery = event.target.value; filterDiff(); };
$('#ignore-array').onchange = staleDiff;
$('#help-dialog').addEventListener('click', event => { if (event.target === $('#help-dialog')) $('#help-dialog').close(); });
window.addEventListener('beforeunload', event => { if (Object.values(docs).some(doc => doc.dirty)) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('keydown', event => {
  if (event.altKey && ['1', '2'].includes(event.key)) { event.preventDefault(); showPage(event.key === '1' ? 'editor' : 'diff'); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !event.defaultPrevented) { event.preventDefault(); download(state.page === 'editor' ? 'editor' : 'left'); }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && state.view === 'tree' && state.page === 'editor') { event.preventDefault(); $('#tree-search').focus(); }
});
window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (event.dataTransfer.files.length) event.preventDefault(); });
if (location.hash === '#diff') showPage('diff');
ensureDoc('editor').then(refreshTree).catch(error => toast(error.message));
