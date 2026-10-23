import { icon } from './icons.js';

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const HISTORY_KEY = 'json-tools-history';
const DISPLAY_LIMIT = 200000;

const outputs = {
  ts: { label: 'TypeScript', file: 'types.ts', mime: 'text/plain' },
  zod: { label: 'Zod', file: 'schema.ts', mime: 'text/plain' },
  csv: { label: 'CSV', file: 'data.csv', mime: 'text/csv', bom: true },
  yaml: { label: 'YAML', file: 'data.yaml', mime: 'text/yaml' },
  env: { label: '.env', file: 'data.env', mime: 'text/plain' },
  mock: { label: 'Mock', file: 'mock.json', mime: 'application/json' },
};
const tabs = { ...outputs, jsonpath: { label: 'JSONPath' }, table: { label: '表格' }, history: { label: '历史' } };

function readHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function writeHistory(list) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

export function createTools({ dialog, rpc, ensureDoc, getText, getIndent, replaceEditor, locate, toast }) {
  const $ = selector => dialog.querySelector(selector);
  const state = { tab: 'ts', output: '', table: null, sort: null, token: 0 };
  dialog.innerHTML = `<div class="dialog-title"><h2>JSON 工具</h2><button class="icon-btn" data-tool-close aria-label="关闭">${icon('close')}</button></div>
    <div class="tool-nav" role="tablist">${Object.entries(tabs).map(([key, tab]) => `<button role="tab" data-tab="${key}">${tab.label}</button>`).join('')}</div>
    <div class="tool-controls"></div><div class="tool-result"></div><div class="tool-actions"></div>`;
  const controls = $('.tool-controls'), result = $('.tool-result'), actions = $('.tool-actions');
  const actionButton = (name, text, handler, primary) => {
    const el = document.createElement('button');
    el.className = `btn${primary ? ' primary' : ''}`;
    el.innerHTML = `${icon(name)}<span>${text}</span>`;
    el.onclick = handler;
    actions.append(el);
    return el;
  };
  const copyText = async text => {
    try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); } catch { toast('浏览器未允许复制，请手动选中后复制'); }
  };
  const saveFile = ({ file, mime, bom }, text) => {
    const url = URL.createObjectURL(new Blob([bom ? `﻿${text}` : text], { type: `${mime};charset=utf-8` }));
    Object.assign(document.createElement('a'), { href: url, download: file }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  async function renderOutput(kind) {
    const spec = outputs[kind], token = ++state.token;
    if (kind === 'mock') {
      controls.innerHTML = '<label>生成条数 <input id="mock-count" type="number" min="1" max="10000" value="50" /></label><span class="tool-hint">数组按现有元素循环复制到 N 条，id 类字段自增；非数组则以整份内容为模板</span>';
    }
    const load = async () => {
      result.innerHTML = '<p class="tool-empty">生成中…</p>';
      try {
        const count = Number($('#mock-count')?.value);
        const { result: text } = await rpc('generate', { side: 'editor', kind, count, indent: getIndent() });
        if (token !== state.token) return;
        state.output = text;
        const shown = text.length > DISPLAY_LIMIT ? `${text.slice(0, DISPLAY_LIMIT)}\n…（仅显示前 ${DISPLAY_LIMIT.toLocaleString('zh-CN')} 字符，复制与下载为完整内容）` : text;
        result.innerHTML = `<pre class="tool-output" tabindex="0">${esc(shown)}</pre>`;
      } catch (error) { if (token === state.token) result.innerHTML = `<p class="tool-empty error">${esc(error.message)}</p>`; }
    };
    actions.replaceChildren();
    actionButton('copy', '复制', () => copyText(state.output), true);
    actionButton('download', '下载', () => saveFile(spec, state.output));
    if (kind === 'mock') {
      actionButton('format', '替换编辑器内容', () => { replaceEditor(state.output, 'Mock 数据'); dialog.close(); });
      $('#mock-count').onchange = load;
    }
    await load();
  }

  function renderJsonPath() {
    const token = ++state.token;
    controls.innerHTML = '<input id="path-query" class="tool-input" value="$" spellcheck="false" aria-label="JSONPath 表达式" placeholder="例如 $.list[*].id、$..name、$.items[?(@.price > 10)]" />';
    actions.replaceChildren();
    let json = '[]', timer;
    actionButton('copy', '复制匹配值', () => copyText(json), true);
    const run = async () => {
      try {
        const { result: out } = await rpc('jsonpath', { side: 'editor', query: $('#path-query').value });
        if (token !== state.token) return;
        json = out.json;
        const rows = out.matches.slice(0, 500);
        result.innerHTML = `<p class="tool-hint">${out.total.toLocaleString('zh-CN')} 个匹配${out.truncated ? '，仅保留前 5,000 个' : ''}${out.matches.length > rows.length ? '，列表显示前 500 个' : ''} · 点击跳转到编辑器</p>
          <div class="path-list">${rows.map((m, i) => `<button class="path-row" data-i="${i}"><code>${esc(m.path)}</code><span>${esc(m.preview)}</span></button>`).join('')}</div>`;
        result.querySelectorAll('.path-row').forEach(el => {
          el.onclick = () => { const m = rows[el.dataset.i]; dialog.close(); locate(m.offset, m.length); };
        });
      } catch (error) { if (token === state.token) result.innerHTML = `<p class="tool-empty error">${esc(error.message)}</p>`; }
    };
    $('#path-query').oninput = () => { clearTimeout(timer); timer = setTimeout(run, 250); };
    run();
  }

  async function renderTable() {
    const token = ++state.token;
    controls.innerHTML = '<input id="table-filter" class="tool-input" placeholder="筛选任意单元格" aria-label="筛选表格" />';
    actions.replaceChildren();
    result.innerHTML = '<p class="tool-empty">生成中…</p>';
    const { result: data } = await rpc('table', { side: 'editor' });
    if (token !== state.token) return;
    state.table = data;
    state.sort = null;
    const draw = () => {
      const needle = $('#table-filter').value.toLocaleLowerCase();
      let rows = needle ? data.rows.filter(row => row.some(cell => cell.toLocaleLowerCase().includes(needle))) : data.rows.slice();
      if (state.sort) {
        const { index, dir } = state.sort;
        rows.sort((a, b) => {
          const x = a[index], y = b[index], nx = Number(x), ny = Number(y);
          const order = x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y, 'zh-CN');
          return order * dir;
        });
      }
      const shown = rows.slice(0, 500);
      result.innerHTML = `<p class="tool-hint">数据来源 ${esc(data.source)} · 共 ${data.total.toLocaleString('zh-CN')} 行 · 匹配 ${rows.length.toLocaleString('zh-CN')} 行${rows.length > shown.length ? '，显示前 500 行' : ''}${data.total > data.rows.length ? '（仅载入前 5,000 行）' : ''} · 点击表头排序</p>
        <div class="table-wrap"><table><thead><tr>${data.columns.map((c, i) => `<th data-i="${i}">${esc(c)}${state.sort?.index === i ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${shown.map(row => `<tr>${row.map(cell => `<td title="${esc(cell)}">${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      result.querySelectorAll('th').forEach(th => {
        th.onclick = () => {
          const index = Number(th.dataset.i);
          state.sort = { index, dir: state.sort?.index === index ? -state.sort.dir : 1 };
          draw();
        };
      });
    };
    $('#table-filter').oninput = draw;
    draw();
  }

  function renderHistory() {
    ++state.token;
    controls.innerHTML = '<span class="tool-hint">快照只保存在本机浏览器，最多 10 条；不会自动保存，也不会上传</span>';
    actions.replaceChildren();
    const draw = () => {
      const list = readHistory();
      result.innerHTML = list.length ? `<div class="path-list">${list.map((item, i) => `<div class="history-row"><span>${esc(new Date(item.time).toLocaleString('zh-CN', { hour12: false }))}</span><code>${esc(item.preview)}</code><small>${(item.text.length / 1024).toFixed(1)} KB</small><button class="btn" data-restore="${i}">恢复</button><button class="btn quiet" data-remove="${i}">删除</button></div>`).join('')}</div>` : '<p class="tool-empty">暂无快照</p>';
      result.querySelectorAll('[data-restore]').forEach(el => { el.onclick = () => { replaceEditor(list[el.dataset.restore].text, '历史快照'); dialog.close(); }; });
      result.querySelectorAll('[data-remove]').forEach(el => { el.onclick = () => { list.splice(Number(el.dataset.remove), 1); writeHistory(list); draw(); }; });
    };
    actionButton('plus', '保存当前内容', () => {
      const text = getText();
      if (!text.trim()) { toast('当前文档为空'); return; }
      if (text.length > 1024 * 1024) { toast('超过 1 MB，未保存快照'); return; }
      const list = [{ time: Date.now(), text, preview: text.replace(/\s+/g, ' ').slice(0, 80) }, ...readHistory()].slice(0, 10);
      toast(writeHistory(list) ? '已保存快照' : '浏览器存储已满或被禁用，未能保存');
      draw();
    }, true);
    draw();
  }

  async function open(tab) {
    state.tab = tab;
    state.token++;
    dialog.querySelectorAll('[data-tab]').forEach(el => el.setAttribute('aria-selected', String(el.dataset.tab === tab)));
    controls.replaceChildren();
    actions.replaceChildren();
    if (!dialog.open) dialog.showModal();
    if (tab === 'history') return renderHistory();
    try { await ensureDoc(); } catch (error) {
      result.innerHTML = `<p class="tool-empty error">${esc(error.message)}</p>`;
      return;
    }
    if (state.tab !== tab) return;
    if (tab === 'jsonpath') renderJsonPath(); else if (tab === 'table') await renderTable(); else await renderOutput(tab);
  }

  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-tool-close]')) dialog.close();
    const tab = event.target.closest('[data-tab]')?.dataset.tab;
    if (tab) open(tab);
  });
  return { open };
}
