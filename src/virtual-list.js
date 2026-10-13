export function rowOffsets(count, estimate, heights) {
  const offsets = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + (heights.get(i) ?? estimate);
  return offsets;
}

export function rowAt(offsets, position) {
  let low = 0, high = offsets.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (offsets[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, Math.min(low, offsets.length - 2));
}

export class VirtualList {
  constructor(element, { rowHeight, renderRow, emptyText = '没有匹配的结果', variableHeight = false }) {
    this.element = element;
    this.rowHeight = rowHeight;
    this.renderRow = renderRow;
    this.emptyText = emptyText;
    this.variableHeight = variableHeight;
    this.heights = new Map();
    this.offsets = new Float64Array(1);
    this.width = 0;
    this.pendingIndex = null;
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
    this.heights.clear();
    this.pendingIndex = null;
    if (this.variableHeight) this.offsets = rowOffsets(rows.length, this.rowHeight, this.heights);
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
    if (this.variableHeight) { this.renderVariable(); return; }
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
  renderVariable() {
    const { clientWidth: width, clientHeight: height } = this.element;
    if (!width || !height) return;
    // 分栏或窗口变宽会改变折行，重新测量并保留当前所在的结果项。
    if (width !== this.width) {
      const anchor = rowAt(this.offsets, this.element.scrollTop);
      this.width = width;
      this.heights.clear();
      this.offsets = rowOffsets(this.rows.length, this.rowHeight, this.heights);
      this.spacer.style.height = `${this.offsets.at(-1)}px`;
      this.element.scrollTop = this.offsets[anchor];
    }
    if (this.pendingIndex !== null) this.centerRow(this.pendingIndex);
    const atBottom = this.element.scrollTop > 0 && this.element.scrollTop + height >= this.offsets.at(-1) - 1;
    const anchor = rowAt(this.offsets, this.element.scrollTop);
    const inset = this.element.scrollTop - this.offsets[anchor];
    const start = Math.max(0, anchor - 8);
    const end = Math.min(this.rows.length, rowAt(this.offsets, this.element.scrollTop + height) + 9);
    const fragment = document.createDocumentFragment();
    const rendered = [];
    for (let i = start; i < end; i++) {
      const row = this.renderRow(this.rows[i], i);
      row.style.position = 'absolute';
      row.style.top = `${this.offsets[i]}px`;
      row.style.minHeight = `${this.rowHeight}px`;
      rendered.push(row);
      fragment.append(row);
    }
    this.spacer.replaceChildren(fragment);
    let changed = false;
    rendered.forEach((row, i) => {
      const measured = Math.ceil(row.getBoundingClientRect().height);
      const index = start + i;
      if (measured !== (this.heights.get(index) ?? this.rowHeight)) changed = true;
      this.heights.set(index, measured);
    });
    if (changed) {
      this.offsets = rowOffsets(this.rows.length, this.rowHeight, this.heights);
      this.spacer.style.height = `${this.offsets.at(-1)}px`;
      rendered.forEach((row, i) => { row.style.top = `${this.offsets[start + i]}px`; });
      // 前面的结果变高时补偿滚动位置，避免正在阅读的内容跳动。
      this.element.scrollTop = atBottom ? this.offsets.at(-1) - height
        : this.offsets[anchor] + Math.min(inset, this.offsets[anchor + 1] - this.offsets[anchor] - 1);
      if (this.pendingIndex !== null) this.centerRow(this.pendingIndex);
      this.schedule();
    } else this.pendingIndex = null;
  }
  centerRow(index) {
    const height = this.offsets[index + 1] - this.offsets[index];
    this.element.scrollTop = Math.max(0, this.offsets[index] - Math.max(0, (this.element.clientHeight - height) / 2));
  }
  scrollTo(index) {
    if (this.variableHeight) {
      if (!this.rows[index]) return;
      this.pendingIndex = index;
      this.render();
      return;
    }
    this.element.scrollTop = Math.max(0, index * this.rowHeight - this.element.clientHeight / 2);
    this.render();
  }
}
