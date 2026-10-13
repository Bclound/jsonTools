export class VirtualList {
  constructor(element, { rowHeight, renderRow, emptyText = '没有匹配的结果' }) {
    this.element = element;
    this.rowHeight = rowHeight;
    this.renderRow = renderRow;
    this.emptyText = emptyText;
    this.rows = [];
    this.spacer = document.createElement('div');
    this.spacer.className = 'virtual-spacer';
    element.replaceChildren(this.spacer);
    element.addEventListener('scroll', () => this.schedule());
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(element);
  }
  setRows(rows, reset = false) {
    this.rows = rows;
    if (reset) this.element.scrollTop = 0;
    this.spacer.style.height = `${rows.length * this.rowHeight}px`;
    this.render();
  }
  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }
  render() {
    if (!this.rows.length) {
      this.spacer.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.textContent = this.emptyText;
      this.spacer.append(empty);
      return;
    }
    const start = Math.max(0, Math.floor(this.element.scrollTop / this.rowHeight) - 8);
    const end = Math.min(this.rows.length, start + Math.ceil(this.element.clientHeight / this.rowHeight) + 16);
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const row = this.renderRow(this.rows[i], i);
      row.style.position = 'absolute';
      row.style.top = `${i * this.rowHeight}px`;
      row.style.height = `${this.rowHeight}px`;
      fragment.append(row);
    }
    this.spacer.replaceChildren(fragment);
  }
  scrollTo(index) {
    this.element.scrollTop = Math.max(0, index * this.rowHeight - this.element.clientHeight / 2);
    this.render();
  }
}
