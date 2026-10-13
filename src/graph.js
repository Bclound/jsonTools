import { icon } from './icons.js';
import { layoutGraph, visibleCards, visibleFieldRange, CARD_WIDTH as WIDTH, CARD_HEADER as HEADER, FIELD_HEIGHT as ROW } from './graph-layout.js';

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export class GraphView {
  constructor(element, { select, toggle }) {
    this.element = element;
    this.callbacks = { select, toggle };
    this.x = 20; this.y = 20; this.scale = 1; this.selected = -1;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-links';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.layer = document.createElement('div');
    this.layer.className = 'graph-layer';
    element.append(this.canvas, this.layer);
    let drag;
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      drag = { x: event.clientX, y: event.clientY, startX: this.x, startY: this.y };
      this.autoFit = false;
      element.setPointerCapture(event.pointerId);
      element.classList.add('dragging');
      element.focus();
    });
    element.addEventListener('pointermove', event => {
      if (!drag) return;
      this.x = drag.startX + event.clientX - drag.x;
      this.y = drag.startY + event.clientY - drag.y;
      this.schedule();
    });
    const stop = () => { drag = null; element.classList.remove('dragging'); };
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointercancel', stop);
    element.addEventListener('wheel', event => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      this.zoom(Math.exp(-event.deltaY * .002), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    element.addEventListener('keydown', event => {
      if (event.target !== element) return;
      const move = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[event.key];
      if (move) { event.preventDefault(); this.autoFit = false; this.x += move[0]; this.y += move[1]; this.schedule(); }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoom(1.2); }
      if (event.key === '-') { event.preventDefault(); this.zoom(1 / 1.2); }
    });
    this.autoFit = true;
    this.observer = new ResizeObserver(() => this.autoFit ? this.fit() : this.select(this.selected, true));
    this.observer.observe(element);
  }
  clear(message = '粘贴 JSON 后查看结构') {
    this.layout = null;
    this.layer.replaceChildren();
    this.element.dataset.empty = message;
    this.render();
  }
  setData(data, recenter = false) {
    delete this.element.dataset.empty;
    this.data = data;
    this.layout = layoutGraph(data);
    if (recenter) this.fit(); else this.render();
  }
  fit() {
    this.autoFit = true;
    if (!this.layout || !this.element.clientWidth) return;
    const { width, height } = this.layout;
    this.scale = Math.max(.00001, Math.min(1, (this.element.clientWidth - 64) / width, (this.element.clientHeight - 64) / height));
    this.x = (this.element.clientWidth - width * this.scale) / 2;
    this.y = (this.element.clientHeight - height * this.scale) / 2;
    this.render();
  }
  zoom(factor, x = this.element.clientWidth / 2, y = this.element.clientHeight / 2) {
    this.autoFit = false;
    const scale = Math.max(.00001, Math.min(2, this.scale * factor));
    this.x = x - (x - this.x) / this.scale * scale;
    this.y = y - (y - this.y) / this.scale * scale;
    this.scale = scale;
    this.render();
  }
  resetZoom() { this.scale = 1; this.select(this.selected, true); }
  has(id) { return this.layout?.targets.has(id); }
  select(id, reveal = false) {
    this.selected = id;
    const target = this.layout?.targets.get(id);
    if (reveal && target) {
      this.autoFit = false;
      this.scale = Math.max(.85, this.scale);
      this.x = this.element.clientWidth / 2 - target.x * this.scale;
      this.y = this.element.clientHeight / 2 - target.y * this.scale;
    }
    this.schedule();
  }
  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }
  drawCanvas(bounds, cards) {
    const width = this.element.clientWidth, height = this.element.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
      this.canvas.style.width = `${width}px`; this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.layout) return;
    ctx.setTransform(ratio * this.scale, 0, 0, ratio * this.scale, ratio * this.x, ratio * this.y);
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeStyle = '#becdbc';
    ctx.beginPath();
    for (const edge of this.layout.edges) {
      const a = this.layout.byId.get(edge.from), b = this.layout.byId.get(edge.to);
      const x = a.x + WIDTH, y = a.y + HEADER + edge.row * ROW + ROW / 2, endY = b.y + HEADER / 2;
      if (x > bounds.right || b.x < bounds.left || Math.max(y, endY) < bounds.top || Math.min(y, endY) > bounds.bottom) continue;
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 42, y, b.x - 42, endY, b.x, endY);
    }
    ctx.stroke();
    // 全图概览用画布绘制轮廓，放大后再呈现可操作的字段，避免一次生成海量 DOM。
    if (this.scale < .35) {
      ctx.fillStyle = '#edf4e7'; ctx.strokeStyle = '#9eb292';
      for (const card of cards) {
        ctx.fillRect(card.x, card.y, WIDTH, card.height);
        ctx.strokeRect(card.x, card.y, WIDTH, card.height);
      }
      const target = this.layout.targets.get(this.selected);
      if (target) {
        ctx.fillStyle = '#54863d';
        ctx.fillRect(target.card.x, target.y - ROW / 2, WIDTH, ROW);
      }
    }
  }
  render() {
    this.layer.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    const percent = this.scale * 100;
    document.querySelector('#graph-zoom').textContent = `${percent < 1 ? percent.toFixed(2) : Math.round(percent)}%`;
    const bounds = {
      left: -this.x / this.scale - 80, top: -this.y / this.scale - 80,
      right: (this.element.clientWidth - this.x) / this.scale + 80,
      bottom: (this.element.clientHeight - this.y) / this.scale + 80,
    };
    const cards = this.layout ? visibleCards(this.layout, bounds) : [];
    this.drawCanvas(bounds, cards);
    this.layer.replaceChildren();
    if (this.scale < .35) return;
    for (const card of cards) {
      const el = document.createElement('section');
      el.className = `graph-card${card.id === this.selected ? ' selected' : ''}`;
      el.style.cssText = `left:${card.x}px;top:${card.y}px;width:${WIDTH}px;height:${card.height}px`;
      el.setAttribute('aria-label', card.path);
      el.innerHTML = `<div class="graph-card-title"><button class="graph-title-select" title="定位 ${esc(card.path)}">${esc(typeof card.key === 'number' ? `[${card.key}]` : card.key)}<small>${card.type === 'array' ? `数组 · ${card.count}` : card.type === 'object' ? `对象 · ${card.count}` : card.type}</small></button></div>`;
      el.querySelector('.graph-title-select').onclick = () => this.callbacks.select(card);
      const range = visibleFieldRange(card, bounds);
      for (let i = range.from; i < range.to; i++) {
        const row = card.rows[i];
        const field = document.createElement('div');
        field.className = `graph-field${row.id === this.selected ? ' selected' : ''}`;
        field.style.cssText = `position:absolute;top:${HEADER + i * ROW}px;left:0;right:0`;
        field.dataset.path = row.path;
        field.innerHTML = `<button class="graph-value" title="${esc(row.path)}: ${esc(row.value)}"><span class="graph-key">${esc(typeof row.key === 'number' ? `[${row.key}]` : row.key)}</span><span class="type-${row.type}">${esc(row.value)}</span></button>${row.expandable ? `<button class="graph-toggle" title="${row.open ? '收起' : '展开'} ${esc(row.path)}" aria-label="${row.open ? '收起' : '展开'} ${esc(row.path)}" aria-expanded="${row.open}">${icon(row.open ? 'fold' : 'plus')}</button>` : ''}`;
        field.querySelector('.graph-value').onclick = () => this.callbacks.select(row);
        field.querySelector('.graph-toggle')?.addEventListener('click', () => this.callbacks.toggle(row));
        el.append(field);
      }
      if (!card.rows.length) {
        const empty = document.createElement('div'); empty.className = 'graph-empty-value'; empty.textContent = card.value; el.append(empty);
      }
      this.layer.append(el);
    }
  }
}
