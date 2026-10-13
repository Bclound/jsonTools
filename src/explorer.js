import { VirtualList } from './virtual-list.js';
import { GraphView } from './graph.js';
import { icon } from './icons.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fmt = number => number.toLocaleString('zh-CN');

export function createExplorer({ rpc, ensureDoc, getRevision, isSynced, getLength, locate, toast, onSearchResults }) {
  let graphRequest = 0, searchRequest = 0, focusRequest = 0;
  let timer, searchTimer, focusTimer, position = 0, focusRow;
  let options = { collapsed: [] };
  let selectedSearch = -1;
  let searchOpen = false;
  const current = version => version === getRevision();
  const graph = new GraphView($('#graph-canvas'), {
    select(row) { if (isSynced()) locate(row.offset, 0); },
    toggle(row) {
      options.collapsed = row.open ? [...new Set([...options.collapsed, row.id])] : options.collapsed.filter(id => id !== row.id);
      refreshGraph().catch(report);
    },
  });
  function mark(value) {
    const query = $('#node-search').value.trim();
    if (!query) return esc(value);
    const at = String(value).toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
    if (at < 0) return esc(value);
    return `${esc(value.slice(0, at))}<mark>${esc(value.slice(at, at + query.length))}</mark>${esc(value.slice(at + query.length))}`;
  }
  const results = new VirtualList($('#search-list'), { rowHeight: 72, variableHeight: true, emptyText: '没有匹配的字段、值或路径', renderRow: (row, index) => {
    const el = document.createElement('div');
    el.className = `search-result${selectedSearch === index ? ' selected' : ''}`;
    el.innerHTML = `<button class="search-hit" title="${esc(row.path)}\n${esc(row.value)}"><span class="search-hit-path">${mark(row.path)}</span><span class="search-hit-value type-${row.type}">${mark(row.value)}</span><span class="search-hit-meta">${row.match} · 第 ${fmt(row.line)} 行</span></button><button class="icon-btn search-copy" aria-label="复制路径 ${esc(row.path)}" title="复制完整路径">${icon('copy')}</button>`;
    el.querySelector('.search-hit').onclick = () => chooseResult(index);
    el.querySelector('.search-copy').onclick = () => copyPath(row.path);
    return el;
  } });
  function showResults(open) {
    searchOpen = open;
    const visible = open && Boolean($('#node-search').value.trim());
    $('#search-results').hidden = !visible;
    $('#node-search').setAttribute('aria-expanded', String(visible));
    if (visible) results.schedule();
  }
  function setResults(rows, reset = false) {
    results.setRows(rows, reset);
    onSearchResults(rows);
  }
  async function copyPath(path = focusRow?.path) {
    if (!path) return;
    try { await navigator.clipboard.writeText(path); toast('已复制路径'); }
    catch { toast('浏览器未允许复制，可直接选中路径文字复制'); }
  }
  function report(error) {
    if (isSynced()) toast(error.message);
  }
  function setPath(row, message = '') {
    focusRow = row;
    $('#focus-path').textContent = row?.path || message || '$';
    $('#focus-path').title = row?.path || message;
    $('#copy-path').disabled = !row;
    $('#reveal-focus').disabled = !row;
    $('#graph-path').textContent = row?.path || '$';
    $('#graph-path').title = row?.path || '$';
    $('#focus-type').textContent = row ? ({ object: '对象', array: '数组', string: '字符串', number: '数字', boolean: '布尔值', null: 'null' }[row.type]) : '';
  }
  async function refreshGraph(recenter = false) {
    if (!isSynced()) return;
    const version = getRevision(), request = ++graphRequest;
    const { result } = await rpc('graph', { side: 'editor', ...options });
    if (!current(version) || request !== graphRequest) return;
    $('#graph-info').textContent = `${fmt(result.total)} 个节点`;
    graph.setData(result, recenter);
    if (focusRow) graph.select(focusRow.id);
  }
  async function updateFocus(reveal = true) {
    if (!isSynced() || !getLength()) return;
    const version = getRevision(), request = ++focusRequest;
    const { result } = await rpc('focus', { side: 'editor', position });
    if (!current(version) || request !== focusRequest) return;
    setPath(result);
    if (!graph.has(result.id)) {
      options.collapsed = options.collapsed.filter(id => !result.ancestors.includes(id));
      await refreshGraph();
    }
    if (current(version) && request === focusRequest) graph.select(result.id, reveal);
  }
  async function runSearch() {
    clearTimeout(searchTimer);
    const query = $('#node-search').value.trim(), request = ++searchRequest;
    showResults(searchOpen);
    if (!query) { setResults([]); $('#search-count').textContent = ''; return; }
    $('#search-count').textContent = '搜索中…';
    selectedSearch = -1;
    setResults([], true);
    if (!getLength()) { $('#search-count').textContent = '0 项'; return; }
    const version = getRevision();
    try {
      await ensureDoc();
      if (!current(version) || request !== searchRequest) return;
      const { result } = await rpc('search', { side: 'editor', query });
      if (!current(version) || request !== searchRequest) return;
      setResults(result, true);
      $('#search-count').textContent = `${fmt(result.length)} 项`;
    } catch {
      if (current(version) && request === searchRequest) $('#search-count').textContent = '请先修正 JSON';
    }
  }
  function chooseResult(index, keepOpen = false) {
    if (!isSynced() || !results.rows[index]) return;
    selectedSearch = index;
    const row = results.rows[index];
    locate(row.offset, 0);
    position = row.offset;
    clearTimeout(focusTimer);
    updateFocus(true).catch(report);
    results.scrollTo(index);
    showResults(keepOpen);
  }
  async function refresh() {
    clearTimeout(timer);
    const version = getRevision();
    if (!getLength()) return;
    try {
      await ensureDoc();
      if (!current(version)) return;
      await refreshGraph(true);
      if (!current(version)) return;
      await Promise.all([runSearch(), updateFocus()]);
    } catch {
      if (current(version)) {
        graph.clear('请先修正 JSON 格式');
        setPath(null, 'JSON 格式有误，暂不能定位');
        $('#search-count').textContent = $('#node-search').value.trim() ? '请先修正 JSON' : '';
      }
    }
  }
  function changed() {
    graphRequest++; searchRequest++; focusRequest++;
    clearTimeout(timer); clearTimeout(searchTimer); clearTimeout(focusTimer);
    options = { collapsed: [] };
    graph.clear(getLength() ? '正在解析…' : '粘贴 JSON 后查看结构');
    setResults([], true);
    $('#search-count').textContent = '';
    $('#graph-info').textContent = '';
    $('#graph-path').textContent = '$';
    setPath(null, getLength() ? '正在解析…' : '$');
    if (getLength()) timer = setTimeout(refresh, 350);
  }
  function cursor(view) {
    position = view.state.selection.main.head;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(() => updateFocus().catch(report), 60);
  }
  $('#node-search').oninput = () => {
    searchRequest++;
    clearTimeout(searchTimer);
    setResults([], true);
    showResults(true);
    searchTimer = setTimeout(runSearch, 220);
  };
  $('#node-search').onkeydown = event => {
    if (event.key === 'Enter' && results.rows.length) {
      event.preventDefault();
      const delta = event.shiftKey ? -1 : 1;
      chooseResult((selectedSearch + delta + results.rows.length) % results.rows.length, true);
      $('#node-search').focus();
    }
  };
  $('#node-search').onfocus = () => showResults(true);
  $('#node-search').onclick = () => showResults(true);
  $('#close-search-results').onclick = () => { $('#node-search').focus(); showResults(false); };
  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.explorer-search, #search-results, [data-action="search"]')) showResults(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && searchOpen) {
      event.preventDefault(); $('#node-search').focus(); showResults(false);
    }
  });
  $('#clear-search').onclick = () => { $('#node-search').value = ''; runSearch(); $('#node-search').focus(); };
  $('#copy-path').onclick = () => copyPath();
  $('#reveal-focus').onclick = () => updateFocus(true).catch(report);
  $('#graph-fit').onclick = () => graph.fit();
  $('#graph-zoom').onclick = () => graph.resetZoom();
  $('#graph-in').onclick = () => graph.zoom(1.2);
  $('#graph-out').onclick = () => graph.zoom(1 / 1.2);
  graph.clear();
  setPath(null, '$');
  return { refresh, changed, cursor, search: () => { $('#node-search').focus(); $('#node-search').select(); showResults(true); } };
}
