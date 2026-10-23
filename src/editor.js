import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, keymap, highlightActiveLine, drawSelection, dropCursor, rectangularSelection, Decoration, ViewPlugin, placeholder, hoverTooltip } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { json } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';
import { hoverInfo } from './tools-core.js';

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--editor-foreground)', backgroundColor: 'var(--editor-bg)', fontSize: '13px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)', lineHeight: '1.7' },
  '.cm-content': { padding: '10px 0 60px', caretColor: 'var(--editor-foreground)' },
  '.cm-line': { padding: '0 24px 0 12px' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--gutter)', border: 'none', padding: '0 0 0 14px', minWidth: '50px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 0' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)', boxShadow: 'inset 0 0 0 1px var(--border-strong)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-bg)', color: 'var(--gutter-active)' },
  '&.cm-focused': { outline: 'none' },
  '& .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection-inactive)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection-match)', outline: '1px solid var(--border-strong)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--editor-foreground)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
  '.cm-panels, .cm-tooltip': { backgroundColor: 'var(--panel)', borderColor: 'var(--border-strong)', color: 'var(--foreground)' },
  '.cm-textfield': { background: 'var(--input)', color: 'var(--foreground)', border: '1px solid var(--border-strong)', borderRadius: '2px', padding: '4px' },
  '.cm-button': { color: 'var(--foreground)', background: 'var(--panel-header)', border: '1px solid var(--border-strong)', borderRadius: '2px', fontSize: '12px' },
  '.cm-button:hover': { background: 'var(--hover)' },
  '.cm-searchMatch': { backgroundColor: 'var(--match)', outline: '1px solid var(--match-border)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--match)', outline: '2px solid var(--match-border)' },
  '.cm-globalSearchMatch': { backgroundColor: 'var(--match)', outline: '1px solid var(--match-border)', borderRadius: '2px' },
  '.cm-globalSearchMatch-current': { backgroundColor: 'var(--match)', outline: '2px solid var(--match-border)', boxShadow: 'inset 0 -2px var(--match-border)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--panel-header)', color: 'var(--muted)', borderColor: 'var(--border-strong)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--selection-match)', outline: '1px solid var(--subtle)' },
  '.cm-nonmatchingBracket': { color: 'var(--removed)' },
}, { dark: true });
const syntax = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--key)' },
  { tag: tags.string, color: 'var(--string)' },
  { tag: tags.number, color: 'var(--number)' },
  { tag: [tags.bool, tags.null], color: 'var(--keyword)' },
  { tag: tags.punctuation, color: 'var(--editor-foreground)' },
]);
const phrases = {
  'Find': '查找', 'Replace': '替换', 'next': '下一个', 'previous': '上一个', 'all': '全部',
  'match case': '区分大小写', 'regexp': '正则表达式', 'by word': '整词',
  'replace': '替换', 'replace all': '替换全部', 'close': '关闭', 'Fold line': '折叠行',
  'Unfold line': '展开行', 'Go to line': '跳转到行', 'go': '跳转',
};
const setDiff = StateEffect.define();
const diffRanges = StateField.define({
  create: () => [],
  update(ranges, transaction) {
    if (transaction.docChanged) ranges = [];
    for (const effect of transaction.effects) if (effect.is(setDiff)) ranges = effect.value;
    return ranges;
  },
});
function diffDecorations(view) {
  const ranges = view.state.field(diffRanges);
  const marks = [];
  const seen = new Set();
  for (const viewport of view.visibleRanges) {
    let low = 0, high = ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges[middle].to < viewport.from) low = middle + 1;
      else high = middle;
    }
    for (let pos = viewport.from; pos <= viewport.to;) {
      const line = view.state.doc.lineAt(pos);
      while (low < ranges.length && ranges[low].to < line.from) low++;
      const range = ranges[low];
      if (range && range.from <= line.to && !seen.has(line.from)) {
        marks.push(Decoration.line({ class: `cm-diff-${range.kind}` }).range(line.from));
        seen.add(line.from);
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(marks, true);
}
const diffHighlights = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = diffDecorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || update.startState.field(diffRanges) !== update.state.field(diffRanges)) {
      this.decorations = diffDecorations(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });
const setSearch = StateEffect.define();
const emptySearch = { ranges: [], active: -1 };
const searchRanges = StateField.define({
  create: () => emptySearch,
  update(value, transaction) {
    if (transaction.docChanged) value = emptySearch;
    for (const effect of transaction.effects) if (effect.is(setSearch)) value = { ...value, ...effect.value };
    return value;
  },
});
function searchDecorations(view) {
  const { ranges, active } = view.state.field(searchRanges), marks = [];
  for (const viewport of view.visibleRanges) {
    let low = 0, high = ranges.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (ranges[mid].to <= viewport.from) low = mid + 1; else high = mid;
    }
    for (let i = low; i < ranges.length && ranges[i].from < viewport.to; i++) {
      const range = ranges[i];
      marks.push(Decoration.mark({ class: `cm-globalSearchMatch${range.id === active ? ' cm-globalSearchMatch-current' : ''}` })
        .range(Math.max(range.from, viewport.from), Math.min(range.to, viewport.to)));
    }
  }
  return Decoration.set(marks, true);
}
const searchHighlights = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = searchDecorations(view); }
  update(update) {
    if (update.docChanged || update.viewportChanged || update.startState.field(searchRanges) !== update.state.field(searchRanges)) {
      this.decorations = searchDecorations(update.view);
    }
  }
}, { decorations: plugin => plugin.decorations });
export function createEditor(parent, doc, onChange, onCursor, onFormat, onSave, label, onSearch, smartPaste) {
  const indent = new Compartment();
  const readOnly = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [
      diffRanges, diffHighlights, lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
      ...(onSearch ? [searchRanges, searchHighlights] : []),
      drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(), rectangularSelection(),
      highlightActiveLine(), highlightSelectionMatches(), json(), theme, syntaxHighlighting(syntax),
      placeholder('粘贴 JSON'),
      // 悬停数字或字符串时解码时间戳、JWT、Base64；超长单行不扫描。
      hoverTooltip((editor, pos) => {
        const line = editor.state.doc.lineAt(pos);
        const info = line.length < 20000 && hoverInfo(line.text, pos - line.from);
        if (!info) return null;
        return { pos: line.from + info.from, end: line.from + info.to, above: true, create() {
          const dom = document.createElement('div');
          const title = Object.assign(document.createElement('strong'), { textContent: info.title });
          dom.className = 'cm-hover-info';
          dom.append(title, Object.assign(document.createElement('pre'), { textContent: info.text }));
          return { dom };
        } };
      }),
      EditorView.domEventHandlers({
        paste(event, editor) {
          const { from, to } = editor.state.selection.main;
          if (!smartPaste || (editor.state.doc.length && (from !== 0 || to !== editor.state.doc.length))) return false;
          const fixed = smartPaste(event.clipboardData?.getData('text/plain') || '');
          if (fixed == null) return false;
          event.preventDefault();
          editor.dispatch({ changes: { from, to, insert: fixed }, selection: { anchor: 0 }, userEvent: 'input.paste', scrollIntoView: true });
          return true;
        },
        dblclick(event, editor) {
          if (event.button !== 0 || !event.target.closest('.cm-content')) return false;
          // 已排版的内容保留编辑器原生选词；单行 JSON 才触发双击格式化。
          if (editor.state.doc.lines === 1 && /^[\s]*[\[{]/.test(editor.state.sliceDoc(0, Math.min(128, editor.state.doc.length)))) onFormat();
          return false;
        },
      }),
      indent.of(indentUnit.of('  ')), readOnly.of(EditorState.readOnly.of(false)), EditorState.phrases.of(phrases),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      keymap.of([
        ...(onSearch ? [{ key: 'Mod-f', run: () => { onSearch(); return true; } }] : []),
        { key: 'Mod-Shift-f', run: () => { onFormat(); return true; } },
        { key: 'Mod-s', run: () => { onSave(); return true; } },
        ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
      ]),
      EditorView.updateListener.of(update => {
        if (update.docChanged) onChange(update.view);
        if (update.selectionSet || update.docChanged) onCursor(update.view);
      }),
    ] }),
  });
  view.setDiff = ranges => view.dispatch({ effects: setDiff.of(ranges.sort((a, b) => a.from - b.from)) });
  view.setIndent = spaces => view.dispatch({ effects: indent.reconfigure(indentUnit.of(' '.repeat(spaces))) });
  view.setReadOnly = value => view.dispatch({ effects: readOnly.reconfigure([
    EditorState.readOnly.of(value), EditorView.contentAttributes.of({ 'aria-readonly': String(value) }),
  ]) });
  if (onSearch) {
    view.setSearchMatches = rows => {
      // 编辑事务已清空旧范围，避免 onChange 回调中再次派发嵌套事务。
      if (!rows.length && !view.state.field(searchRanges).ranges.length) return;
      const ranges = rows.flatMap(row => row.highlights.map(range => ({ ...range, id: row.id }))).sort((a, b) => a.from - b.from);
      view.dispatch({ effects: setSearch.of({ ranges, active: -1 }) });
    };
    view.setSearchActive = active => view.dispatch({ effects: setSearch.of({ active }) });
  }
  return view;
}

export function linkEditorScroll(left, right) {
  let source = null;
  let frame;
  let paused = 0;
  for (const [from, to] of [[left.scrollDOM, right.scrollDOM], [right.scrollDOM, left.scrollDOM]]) {
    from.addEventListener('scroll', () => {
      if (paused || source === to || !from.clientHeight || !to.clientHeight) return;
      source = from;
      for (const [position, size, client] of [['scrollTop', 'scrollHeight', 'clientHeight'], ['scrollLeft', 'scrollWidth', 'clientWidth']]) {
        const range = from[size] - from[client];
        const target = range > 0 ? from[position] / range * Math.max(0, to[size] - to[client]) : 0;
        if (Math.abs(to[position] - target) > 1) to[position] = target;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { source = null; });
    }, { passive: true });
  }
  // 点击某条差异时保留两侧各自的准确定位，不用滚动比例覆盖它。
  return () => {
    paused++;
    requestAnimationFrame(() => requestAnimationFrame(() => { paused--; }));
  };
}
