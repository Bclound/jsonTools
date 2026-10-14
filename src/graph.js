import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { FlowGraph } from './graph-flow.jsx';
import { layoutGraph, visibleCards, flowGraph, edgeCoordinates, CARD_WIDTH as WIDTH, FIELD_HEIGHT as ROW } from './graph-layout.js';

export class GraphView {
  constructor(element, { select, toggle }) {
    this.element = element;
    this.callbacks = { select, toggle };
    this.x = 20; this.y = 20; this.scale = 1; this.selected = -1;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'graph-links';
    this.canvas.setAttribute('aria-hidden', 'true');
    const host = document.createElement('div');
    host.className = 'graph-flow-host';
    element.append(this.canvas, host);
    this.root = createRoot(host);
    this.model = { nodes: [], edges: [], canvasEdges: false };
    this.onViewportChange = ({ x, y, zoom }) => {
      if (this.x === x && this.y === y && this.scale === zoom) return;
      this.x = x; this.y = y; this.scale = zoom;
      this.schedule();
    };
    this.onMoveStart = event => { if (event) this.autoFit = false; };
    this.onPaneClick = () => element.focus({ preventScroll: true });
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
    this.model = { nodes: [], edges: [], canvasEdges: false };
    this.element.dataset.empty = message;
    this.render();
  }
  setData(data, recenter = false) {
    delete this.element.dataset.empty;
    this.data = data;
    this.layout = layoutGraph(data);
    this.model = flowGraph(this.layout);
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
    const colors = getComputedStyle(this.element);
    ctx.setTransform(ratio * this.scale, 0, 0, ratio * this.scale, ratio * this.x, ratio * this.y);
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeStyle = colors.getPropertyValue('--graph-line');
    ctx.beginPath();
    for (const edge of this.model.canvasEdges || this.scale < .35 ? this.layout.edges : []) {
      const { x, y, endX, endY } = edgeCoordinates(this.layout, edge);
      if (x > bounds.right || endX < bounds.left || Math.max(y, endY) < bounds.top || Math.min(y, endY) > bounds.bottom) continue;
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 42, y, endX - 42, endY, endX, endY);
    }
    ctx.stroke();
    // 全图概览用画布绘制轮廓，放大后再呈现可操作的字段，避免一次生成海量 DOM。
    if (this.scale < .35) {
      ctx.fillStyle = colors.getPropertyValue('--panel'); ctx.strokeStyle = colors.getPropertyValue('--graph-line');
      for (const card of cards) {
        ctx.fillRect(card.x, card.y, WIDTH, card.height);
        ctx.strokeRect(card.x, card.y, WIDTH, card.height);
      }
      const target = this.layout.targets.get(this.selected);
      if (target) {
        ctx.fillStyle = colors.getPropertyValue('--accent');
        ctx.fillRect(target.card.x, target.y - ROW / 2, WIDTH, ROW);
      }
    }
  }
  render() {
    const percent = this.scale * 100;
    document.querySelector('#graph-zoom').textContent = `${percent < 1 ? percent.toFixed(2) : Math.round(percent)}%`;
    const bounds = {
      left: -this.x / this.scale - 80, top: -this.y / this.scale - 80,
      right: (this.element.clientWidth - this.x) / this.scale + 80,
      bottom: (this.element.clientHeight - this.y) / this.scale + 80,
    };
    const cards = this.layout ? visibleCards(this.layout, bounds) : [];
    this.drawCanvas(bounds, cards);
    this.root.render(createElement(FlowGraph, {
      model: this.model, viewport: { x: this.x, y: this.y, zoom: this.scale }, bounds,
      selected: this.selected, callbacks: this.callbacks,
      onViewportChange: this.onViewportChange, onMoveStart: this.onMoveStart, onPaneClick: this.onPaneClick,
    }));
  }
}
