import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { minimapWindow, minimapLineAt, overviewLineAt, overviewTargetAt, matchPixels, firstMatchAt, MINI_LINE_HEIGHT } from './minimap-core.js';

export class CodeMinimap {
  constructor(view, element, navigate) {
    this.view = view;
    this.element = element;
    this.navigate = navigate;
    this.canvas = element.querySelector('canvas');
    this.toggle = element.querySelector('button');
    this.matches = [];
    this.pixels = [];
    this.toggle.onclick = () => {
      const collapsed = element.classList.toggle('collapsed');
      this.toggle.setAttribute('aria-expanded', String(!collapsed));
      this.toggle.setAttribute('aria-label', collapsed ? '展开代码缩略图' : '收起代码缩略图');
      this.toggle.title = collapsed ? '展开代码缩略图' : '收起代码缩略图';
      this.canvas.hidden = collapsed;
      view.requestMeasure();
      this.schedule();
    };
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of(update => {
      if (update.docChanged) this.setMatches([]);
      if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) this.schedule();
    })) });
    view.scrollDOM.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(element);
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      view.scrollDOM.scrollTop += event.deltaY * (event.deltaMode === 1 ? view.defaultLineHeight : event.deltaMode === 2 ? view.scrollDOM.clientHeight : 1);
    }, { passive: false });
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !this.model || !view.state.doc.length) return;
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect(), y = event.clientY - rect.top;
      const overview = event.clientX - rect.left >= rect.width - 10;
      const line = overview ? overviewTargetAt(y, rect.height, view.state.doc.lines, this.matches)
        : minimapLineAt(y, this.model, view.state.doc.lines);
      this.drag = { y: event.clientY, line, overview,
        perPixel: Math.max(1, (view.state.doc.lines - this.model.visible) / Math.max(1, rect.height - this.model.thumbHeight)) };
      this.canvas.setPointerCapture(event.pointerId);
      this.go(line);
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!this.drag) return;
      const rect = this.canvas.getBoundingClientRect();
      const line = this.drag.overview ? overviewLineAt(event.clientY - rect.top, rect.height, view.state.doc.lines)
        : this.drag.line + (event.clientY - this.drag.y) * this.drag.perPixel;
      this.go(line);
    });
    const stop = () => { this.drag = null; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('lostpointercapture', stop);
    this.canvas.addEventListener('keydown', event => {
      const total = view.state.doc.lines, middle = Math.round((this.first + this.last) / 2);
      const target = { ArrowUp: middle - 1, ArrowDown: middle + 1, PageUp: middle - this.model?.visible,
        PageDown: middle + this.model?.visible, Home: 1, End: total }[event.key];
      if (Number.isFinite(target)) { event.preventDefault(); this.go(target); this.canvas.focus({ preventScroll: true }); }
    });
    this.schedule();
  }
  go(line) {
    this.navigate(Math.max(1, Math.min(this.view.state.doc.lines, Math.round(line))));
  }
  setMatches(rows) {
    this.matches = [...new Set(rows.map(row => row.line))].sort((a, b) => a - b);
    this.pixelHeight = -1;
    this.schedule();
  }
  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }
  render() {
    if (this.canvas.hidden || !this.element.clientHeight) return;
    const { view, canvas } = this, width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const doc = view.state.doc;
    canvas.dataset.matchCount = this.matches.length;
    if (!doc.length) {
      this.model = null;
      canvas.setAttribute('aria-valuetext', '文档为空');
      canvas.setAttribute('aria-valuemax', '1'); canvas.setAttribute('aria-valuenow', '1');
      delete canvas.dataset.startLine; delete canvas.dataset.endLine;
      return;
    }
    const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    this.first = doc.lineAt(view.lineBlockAtHeight(Math.max(0, top)).from).number;
    this.last = doc.lineAt(view.lineBlockAtHeight(Math.max(0, top + view.scrollDOM.clientHeight - 1)).to).number;
    const model = this.model = minimapWindow(doc.lines, this.first, this.last, height);
    canvas.setAttribute('aria-valuemax', String(doc.lines));
    canvas.setAttribute('aria-valuenow', String(this.first));
    canvas.setAttribute('aria-valuetext', `当前第 ${this.first} 至 ${this.last} 行，${this.matches.length} 行搜索匹配`);
    canvas.dataset.startLine = model.start;
    canvas.dataset.endLine = model.end;
    ctx.fillStyle = '#dfe7da66';
    ctx.fillRect(0, model.thumbTop, width - 10, model.thumbHeight);
    ctx.strokeStyle = '#adbea0';
    ctx.strokeRect(.5, model.thumbTop + .5, width - 11, model.thumbHeight - 1);
    // 缩略图只读取窗口内的行，十万行文档也不逐帧扫描全文。
    ctx.save(); ctx.beginPath(); ctx.rect(3, 0, width - 16, height); ctx.clip();
    ctx.font = '3px monospace'; ctx.textBaseline = 'top';
    const charWidth = ctx.measureText('M').width;
    const maxChars = Math.ceil((width - 16) / charWidth);
    for (let number = model.start; number <= model.end; number++) {
      const line = doc.line(number), text = doc.sliceString(line.from, Math.min(line.to, line.from + maxChars));
      const y = (number - model.start) * MINI_LINE_HEIGHT;
      ctx.fillStyle = '#8d9b91'; ctx.fillText(text, 4, y);
      for (const token of text.matchAll(/"(?:\\.|[^"\\])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?/g)) {
        ctx.fillStyle = token[0].endsWith(':') ? '#507863' : token[0].startsWith('"') ? '#b18a65' : '#827894';
        ctx.fillText(token[0], 4 + token.index * charWidth, y);
      }
    }
    ctx.fillStyle = '#d9a44180';
    for (let i = firstMatchAt(this.matches, model.start); i < this.matches.length && this.matches[i] <= model.end; i++) {
      ctx.fillRect(0, (this.matches[i] - model.start) * MINI_LINE_HEIGHT, width - 10, MINI_LINE_HEIGHT);
    }
    const focused = doc.lineAt(view.state.selection.main.head).number;
    if (focused >= model.start && focused <= model.end) {
      ctx.fillStyle = '#5e8457'; ctx.fillRect(4, (focused - model.start) * MINI_LINE_HEIGHT, 3, MINI_LINE_HEIGHT);
    }
    ctx.restore();
    ctx.fillStyle = '#e9eee5'; ctx.fillRect(width - 8, 0, 8, height);
    if (this.pixelHeight !== height) { this.pixels = matchPixels(this.matches, doc.lines, height); this.pixelHeight = height; }
    ctx.fillStyle = '#c08a28';
    for (const y of this.pixels) ctx.fillRect(width - 7, y, 6, 2);
    ctx.strokeStyle = '#67885a';
    const markerY = (this.first - 1) / Math.max(1, doc.lines - 1) * (height - 3);
    ctx.strokeRect(width - 7.5, markerY + .5, 7, Math.max(3, (this.last - this.first + 1) / doc.lines * height));
  }
}
