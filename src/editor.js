import { EditorState, Compartment, StateEffect, StateField } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, keymap, highlightActiveLine, drawSelection, dropCursor, rectangularSelection, Decoration, ViewPlugin } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { json } from '@codemirror/lang-json';
import { tags } from '@lezer/highlight';

const theme = EditorView.theme({
  '&': { height: '100%', color: '#34423b', fontSize: '13px' },
  '.cm-scroller': { overflow: 'auto', fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: '1.85' },
  '.cm-content': { padding: '18px 0 60px', caretColor: '#315f4c' },
  '.cm-line': { padding: '0 24px 0 12px' },
  '.cm-gutters': { backgroundColor: '#ffffff', color: '#b0b7b1', border: 'none', padding: '0 0 0 14px', minWidth: '50px' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 0' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#f6f8f4' },
  '&.cm-focused': { outline: 'none' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#dce9de' },
  '.cm-cursor': { borderLeftColor: '#315f4c' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px' },
  '.cm-panels': { backgroundColor: '#f8f9f6', borderColor: '#e3e7e0', color: '#34423b' },
  '.cm-search input': { border: '1px solid #d6ddd5', borderRadius: '4px', padding: '4px' },
  '.cm-button': { background: '#fff', border: '1px solid #d6ddd5', borderRadius: '4px', fontSize: '12px' },
  '.cm-searchMatch': { backgroundColor: '#f7e5af' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#f0cf77' },
});
const syntax = HighlightStyle.define([
  { tag: tags.propertyName, color: '#496257' },
  { tag: tags.string, color: '#a26544' },
  { tag: tags.number, color: '#647d9b' },
  { tag: [tags.bool, tags.null], color: '#906d97' },
  { tag: tags.punctuation, color: '#88918a' },
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
export function createEditor(parent, doc, onChange, onCursor, onFormat, onSave, label) {
  const indent = new Compartment();
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [
      diffRanges, diffHighlights, lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(), history(), foldGutter(),
      drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(), rectangularSelection(),
      highlightActiveLine(), highlightSelectionMatches(), json(), theme, syntaxHighlighting(syntax),
      indent.of(indentUnit.of('  ')), EditorState.phrases.of(phrases),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      keymap.of([
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
  return view;
}
