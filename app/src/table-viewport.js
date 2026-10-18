import { TableView, TableMap, columnResizingPluginKey } from 'prosemirror-tables';
import { tableColumnWidths } from './table-layout.js';

export class TableViewport {
  constructor(editor) {
    this.editor = editor;
    this.visible = new WeakSet();
    this.heights = new WeakMap();
    this.scrolls = new WeakMap();
    this.entries = new Map();
    this.frame = null;
    this.proximityFrame = null;
    this.resizeFrame = null;
    this.resizeItems = new Set();
    this.resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const item = this.entries.get(entry.target);
        if (item?.tableView) this.resizeItems.add(item);
      }
      if (this.resizeFrame === null) this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null;
        const items = [...this.resizeItems]; this.resizeItems.clear();
        for (const item of items) if (item.dom.isConnected) this.fitColumns(item);
      });
    });
    this.observer = new IntersectionObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const item = this.entries.get(entry.target);
        if (!item) continue;
        const root = entry.rootBounds || editor.container.getBoundingClientRect();
        const nearby = entry.boundingClientRect.bottom >= root.top - 900 && entry.boundingClientRect.top <= root.bottom + 900;
        if (nearby && !this.visible.has(item.node)) { this.visible.add(item.node); changed = true; }
      }
      if (changed) this.scheduleRefresh();
    }, { root: editor.container, rootMargin: '900px 120px' });
    this.onContainerScroll = () => {
      if (this.proximityFrame !== null) return;
      this.proximityFrame = requestAnimationFrame(() => { this.proximityFrame = null; this.loadNearby(); });
    };
    editor.container.addEventListener('scroll', this.onContainerScroll, { passive: true });
  }

  scheduleRefresh() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; if (!this.editor.view.isDestroyed) this.editor.refresh(); });
  }

  loadNearby() {
    const bounds = this.editor.container.getBoundingClientRect();
    let changed = false;
    for (const item of this.entries.values()) {
      const box = item.dom.getBoundingClientRect();
      const nearby = box.bottom >= bounds.top - 900 && box.top <= bounds.bottom + 900;
      if (!item.active && !this.visible.has(item.node) && nearby) { this.visible.add(item.node); changed = true; }
      else if (item.active && this.editor.parsed.doc.content.size >= 200000 && !this.selected(item) && (box.bottom < bounds.top - 3000 || box.top > bounds.bottom + 3000)) {
        this.heights.set(item.node, box.height); this.scrolls.set(item.node, item.dom.scrollLeft);
        if (this.visible.has(item.node)) { this.visible.delete(item.node); changed = true; }
      }
    }
    if (changed) this.scheduleRefresh();
  }

  selected(item, view = this.editor.view) {
    const position = item.getPos();
    const selection = view?.state.selection;
    if (position == null || !selection) return false;
    return [selection.anchor, selection.head].some(value => value > position && value < position + item.node.nodeSize);
  }

  active(item, view = this.editor.view) { return this.editor.parsed.doc.content.size < 200000 || this.visible.has(item.node) || this.selected(item, view); }

  fitColumns(item, force = false) {
    const width = item.dom.clientWidth;
    if (!width || columnResizingPluginKey.getState(this.editor.view?.state)?.dragging) return;
    const fontSize = parseFloat(getComputedStyle(item.tableView.table).fontSize) || 14;
    if (!force && item.fittedNode === item.node && item.fittedWidth === width && item.fittedFont === fontSize) return;
    const left = item.dom.scrollLeft;
    const widths = tableColumnWidths(item.node, width, fontSize);
    for (const [index, column] of [...item.tableView.colgroup.children].entries()) column.style.width = widths[index] + 'px';
    const total = widths.reduce((sum, value) => sum + value, 0);
    item.tableView.table.style.width = total + 'px';
    item.tableView.table.style.minWidth = total + 'px';
    item.fittedNode = item.node; item.fittedWidth = width; item.fittedFont = fontSize;
    item.dom.scrollLeft = Math.min(left, Math.max(0, item.dom.scrollWidth - item.dom.clientWidth));
  }

  create(node, view, getPos) {
    const item = { node, getPos };
    item.active = this.active(item, view);
    const tableView = item.active ? new TableView(node, node.attrs.format === 'html' ? 120 : 80) : null;
    item.tableView = tableView;
    const dom = tableView?.dom || document.createElement('div');
    item.dom = dom;
    dom.classList.add('inklet-table');
    dom.dataset.tableFormat = node.attrs.format;
    dom.dataset.tableLoaded = String(item.active);
    if (!item.active) {
      dom.classList.add('table-placeholder');
      dom.contentEditable = 'false';
      dom.style.height = Math.max(100, this.heights.get(node) || node.childCount * 66) + 'px';
      const label = document.createElement('button');
      label.type = 'button'; label.className = 'table-load-button';
      label.textContent = `${node.childCount.toLocaleString()} 行 · ${TableMap.get(node).width} 列`;
      label.title = '显示表格';
      label.addEventListener('click', () => { this.visible.add(item.node); this.scheduleRefresh(); });
      dom.append(label);
    } else {
      const saved = this.scrolls.get(node) || 0;
      const remember = () => this.scrolls.set(item.node, dom.scrollLeft);
      dom.addEventListener('pointerdown', remember, { passive: true });
      dom.addEventListener('scroll', remember, { passive: true });
      requestAnimationFrame(() => { if (dom.isConnected) { this.fitColumns(item, true); dom.scrollLeft = Math.min(saved, Math.max(0, dom.scrollWidth - dom.clientWidth)); } });
    }
    this.entries.set(dom, item);
    this.observer.observe(dom);
    if (tableView) this.resizeObserver.observe(dom);
    return {
      dom, contentDOM: tableView?.contentDOM,
      update: next => {
        if (next.type !== item.node.type) return false;
        if (next !== item.node) {
          if (this.visible.has(item.node)) this.visible.add(next);
          if (this.heights.has(item.node)) this.heights.set(next, this.heights.get(item.node));
          if (this.scrolls.has(item.node)) this.scrolls.set(next, this.scrolls.get(item.node));
        }
        item.node = next;
        if (this.active(item) !== item.active) return false;
        if (!tableView) return true;
        const left = dom.scrollLeft;
        const updated = tableView.update(next);
        if (updated) { this.fitColumns(item, true); dom.scrollLeft = Math.min(left, Math.max(0, dom.scrollWidth - dom.clientWidth)); }
        return updated;
      },
      ignoreMutation: mutation => tableView ? tableView.ignoreMutation(mutation) : mutation.type !== 'selection',
      stopEvent: event => !item.active && event.target.closest('button'),
      destroy: () => {
        if (item.active) { this.heights.set(item.node, dom.getBoundingClientRect().height); this.scrolls.set(item.node, dom.scrollLeft); }
        this.observer.unobserve(dom); this.resizeObserver.unobserve(dom); this.entries.delete(dom);
      },
    };
  }

  ensure(position) {
    let changed = false;
    for (const item of this.entries.values()) {
      const start = item.getPos();
      if (start != null && position >= start && position <= start + item.node.nodeSize && !item.active) {
        this.visible.add(item.node); changed = true;
      }
    }
    if (changed) this.editor.refresh();
  }

  destroy() {
    this.observer.disconnect(); this.resizeObserver.disconnect(); this.editor.container.removeEventListener('scroll', this.onContainerScroll);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    if (this.proximityFrame !== null) cancelAnimationFrame(this.proximityFrame);
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame);
    this.resizeItems.clear();
  }
}