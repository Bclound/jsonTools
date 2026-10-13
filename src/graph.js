import { icon } from './icons.js';

const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const WIDTH = 274, HEADER = 36, ROW = 30;

export class GraphView {
  constructor(element, { select, toggle, page, focus }) {
    this.element = element;
    this.callbacks = { select, toggle, page, focus };
    this.x = 20; this.y = 20; this.scale = 1;
    this.selected = -1; this.cards = []; this.edges = [];
    this.layer = document.createElement('div');
    this.layer.className = 'graph-layer';
    element.append(this.layer);
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
    this.observer = new ResizeObserver(() => this.autoFit ? this.fit() : this.schedule());
    this.observer.observe(element);
  }
  clear(message = '粘贴 JSON 后查看结构') {
    this.cards = []; this.edges = []; this.layer.replaceChildren();
    this.element.dataset.empty = message;
  }
  setData(data, recenter = false) {
    delete this.element.dataset.empty;
    this.data = data;
    this.cards = data.cards.map(card => ({ ...card, height: HEADER + Math.max(1, card.rows.length) * ROW + (card.pages > 1 ? ROW : 0), children: [] }));
    this.map = new Map(this.cards.map(card => [card.id, card]));
    this.edges = data.edges;
    for (const edge of this.edges) this.map.get(edge.from).children.push(this.map.get(edge.to));
    for (const card of [...this.cards].reverse()) {
      card.span = Math.max(card.height, card.children.reduce((n, child) => n + child.span + 24, -24));
    }
    const place = (card, top) => {
      card.x = card.depth * 354;
      card.y = top + (card.span - card.height) / 2;
      let childTop = top;
      for (const child of card.children) { place(child, childTop); childTop += child.span + 24; }
    };
    place(this.cards[0], 0);
    this.width = Math.max(...this.cards.map(card => card.x + WIDTH));
    this.height = this.cards[0].span;
    if (recenter) this.fit(); else this.render();
  }
  fit() {
    this.autoFit = true;
    if (!this.cards.length || !this.element.clientWidth) return;
    this.scale = Math.max(.22, Math.min(1, (this.element.clientWidth - 64) / this.width, (this.element.clientHeight - 64) / this.height));
    this.x = (this.element.clientWidth - this.width * this.scale) / 2;
    this.y = (this.element.clientHeight - this.height * this.scale) / 2;
    this.render();
  }
  zoom(factor, x = this.element.clientWidth / 2, y = this.element.clientHeight / 2) {
    this.autoFit = false;
    const scale = Math.max(.16, Math.min(2, this.scale * factor));
    this.x = x - (x - this.x) / this.scale * scale;
    this.y = y - (y - this.y) / this.scale * scale;
    this.scale = scale;
    this.render();
  }
  has(id) { return this.cards.some(card => card.id === id || card.rows.some(row => row.id === id)); }
  select(id, reveal = false) {
    this.selected = id;
    if (reveal) {
      const card = this.cards.find(card => card.id === id || card.rows.some(row => row.id === id));
      if (card) {
        this.autoFit = false;
        this.scale = Math.max(.7, this.scale);
        this.x = this.element.clientWidth / 2 - (card.x + WIDTH / 2) * this.scale;
        this.y = this.element.clientHeight / 2 - (card.y + card.height / 2) * this.scale;
      }
    }
    this.schedule();
  }
  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }
  render() {
    this.layer.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.scale})`;
    const zoomLabel = document.querySelector('#graph-zoom');
    if (zoomLabel) zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    if (!this.cards.length) return;
    const left = -this.x / this.scale - 100, top = -this.y / this.scale - 100;
    const right = left + this.element.clientWidth / this.scale + 200, bottom = top + this.element.clientHeight / this.scale + 200;
    const paths = this.edges.map(edge => {
      const a = this.map.get(edge.from), b = this.map.get(edge.to);
      const x = a.x + WIDTH, y = a.y + HEADER + edge.row * ROW + ROW / 2;
      return `<path d="M${x},${y} C${x + 42},${y} ${b.x - 42},${b.y + HEADER / 2} ${b.x},${b.y + HEADER / 2}"/>`;
    }).join('');
    this.layer.innerHTML = `<svg class="graph-links" width="${this.width}" height="${this.height}" aria-hidden="true">${paths}</svg>`;
    for (const card of this.cards) {
      if (card.x > right || card.x + WIDTH < left || card.y > bottom || card.y + card.height < top) continue;
      const el = document.createElement('section');
      el.className = `graph-card${card.id === this.selected ? ' selected' : ''}`;
      el.style.cssText = `left:${card.x}px;top:${card.y}px;width:${WIDTH}px`;
      el.setAttribute('aria-label', card.path);
      el.innerHTML = `<div class="graph-card-title"><button class="graph-title-select" title="定位 ${esc(card.path)}">${esc(typeof card.key === 'number' ? `[${card.key}]` : card.key)}<small>${card.type === 'array' ? `数组 · ${card.count}` : card.type === 'object' ? `对象 · ${card.count}` : card.type}</small></button><button class="graph-focus icon-btn" title="查看此分支" aria-label="查看分支 ${esc(card.path)}">${icon('expand')}</button></div>`;
      el.querySelector('.graph-title-select').onclick = () => this.callbacks.select(card);
      el.querySelector('.graph-focus').onclick = () => this.callbacks.focus(card.id);
      for (const row of card.rows) {
        const field = document.createElement('div');
        field.className = `graph-field${row.id === this.selected ? ' selected' : ''}`;
        field.innerHTML = `<button class="graph-value" title="${esc(row.path)}: ${esc(row.value)}"><span class="graph-key">${esc(typeof row.key === 'number' ? `[${row.key}]` : row.key)}</span><span class="type-${row.type}">${esc(row.value)}</span></button>${row.expandable ? `<button class="graph-toggle" title="${row.open ? '收起' : '展开'} ${esc(row.path)}" aria-label="${row.open ? '收起' : '展开'} ${esc(row.path)}" aria-expanded="${row.open}">${icon(row.open ? 'fold' : 'plus')}</button>` : ''}`;
        field.querySelector('.graph-value').onclick = () => this.callbacks.select(row);
        field.querySelector('.graph-toggle')?.addEventListener('click', () => this.callbacks.toggle(row));
        el.append(field);
      }
      if (!card.rows.length) {
        const empty = document.createElement('div'); empty.className = 'graph-empty-value'; empty.textContent = card.value; el.append(empty);
      }
      if (card.pages > 1) {
        const pager = document.createElement('div'); pager.className = 'graph-pager';
        pager.innerHTML = `<button aria-label="${esc(card.path)} 上一组" ${card.page === 0 ? 'disabled' : ''}>‹</button><span>${card.page * 10 + 1}–${Math.min(card.count, (card.page + 1) * 10)} / ${card.count}</span><button aria-label="${esc(card.path)} 下一组" ${card.page + 1 === card.pages ? 'disabled' : ''}>›</button>`;
        pager.firstElementChild.onclick = () => this.callbacks.page(card.id, card.page - 1);
        pager.lastElementChild.onclick = () => this.callbacks.page(card.id, card.page + 1);
        el.append(pager);
      }
      this.layer.append(el);
    }
  }
}
