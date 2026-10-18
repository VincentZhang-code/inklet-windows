const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

export class ScrollSynchronizer {
  constructor({ source, rich, enabled, visible = () => true }) {
    this.source = source;
    this.rich = rich;
    this.enabled = enabled;
    this.visible = visible;
    this.owner = null;
    this.anchor = null;
    this.navigating = false;
    this.frame = null;
    this.recapture = false;
    this.adjustments = 0;
    this.framesRemaining = 8;
    this.lastFrameAt = 0;
    this.expected = new Map();
    this.listeners = [];
    for (const pane of ['source', 'rich']) {
      const element = this.container(pane);
      const claim = event => {
        if (event.type === 'keydown' && ['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
        this.owner = pane;
        this.expected.delete(pane);
        this.anchor = null;
        this.navigating = false;
        this.framesRemaining = 8;
      };
      for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown', 'focusin']) {
        element.addEventListener(event, claim, { passive: true });
        this.listeners.push(() => element.removeEventListener(event, claim));
      }
    }
    this.resizeObserver = new ResizeObserver(() => this.refresh());
    this.resizeObserver.observe(source.view.scrollDOM);
    this.resizeObserver.observe(rich.container);
    this.resizeObserver.observe(rich.view.dom);
    const onImageLoad = () => this.refresh();
    rich.container.addEventListener('load', onImageLoad, true);
    this.listeners.push(() => rich.container.removeEventListener('load', onImageLoad, true));
    document.fonts?.ready.then(() => this.refresh());
  }

  container(pane) { return pane === 'source' ? this.source.view.scrollDOM : this.rich.container; }

  reset() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null; this.owner = null; this.anchor = null; this.navigating = false;
    this.recapture = false; this.expected.clear(); this.framesRemaining = 8;
  }

  scroll(pane) {
    const expected = this.expected.get(pane);
    if (expected !== undefined && Math.abs(this.container(pane).scrollTop - expected) < 2) return;
    if (this.navigating) { this.schedule(); return; }
    if (!this.enabled()) { this.anchor = null; return; }
    if (this.owner && this.owner !== pane) return;
    this.owner = pane;
    this.recapture = true;
    this.adjustments = 0;
    this.framesRemaining = 8;
    this.schedule();
  }

  refresh() {
    if (!this.enabled() && !this.navigating) { this.anchor = null; return; }
    if (!this.owner) return;
    if (performance.now() - this.lastFrameAt > 200) this.framesRemaining = 8;
    this.adjustments = 0;
    this.schedule();
  }

  navigate(position) {
    if (!this.visible('source') && !this.visible('rich')) return;
    if (this.frame !== null) { cancelAnimationFrame(this.frame); this.frame = null; }
    this.expected.clear();
    this.rich.flush();
    const range = this.rich.parsed.ranges[this.sourceIndex(position)];
    if (!range) return;
    this.rich.tables?.ensure(range.position + 1);
    const line = this.source.view.state.doc.lineAt(clamp(position, 0, this.source.view.state.doc.length));
    const run = this.rich.parsed.runs.find(item => item.to >= position && item.from <= line.to && item.from >= range.from && item.to <= range.to);
    this.owner = this.visible('rich') ? 'rich' : 'source';
    this.anchor = { from: range.from, progress: 0, viewportFraction: 0.2 };
    if (run) { this.anchor.text = Math.max(position, run.from); this.anchor.lineProgress = 0; }
    this.navigating = true;
    this.recapture = false;
    this.document = this.rich.parsed.source;
    this.adjustments = 0;
    this.framesRemaining = 8;
    this.schedule();
  }

  schedule() {
    if (this.frame !== null || this.framesRemaining <= 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.framesRemaining--;
      this.lastFrameAt = performance.now();
      try { this.synchronize(); }
      catch (error) {
        this.framesRemaining = 0;
        this.anchor = null;
        this.navigating = false;
        console.error('Inklet scroll synchronization stopped', error);
      }
    });
  }

  sourceIndex(position) {
    const ranges = this.rich.parsed.ranges;
    let left = 0;
    let right = ranges.length - 1;
    while (left < right) {
      const middle = Math.ceil((left + right) / 2);
      if (ranges[middle].from <= position) left = middle;
      else right = middle - 1;
    }
    return left;
  }

  sourceY(position) {
    const view = this.source.view;
    position = clamp(position, 0, view.state.doc.length);
    return view.documentTop + view.lineBlockAt(position).top;
  }

  richElement(index) {
    const range = this.rich.parsed.ranges[index];
    return range ? this.rich.view.nodeDOM(range.position) : null;
  }

  richIndex(screenY) {
    const ranges = this.rich.parsed.ranges;
    let left = 0;
    let right = ranges.length - 1;
    while (left < right) {
      const middle = Math.ceil((left + right) / 2);
      const element = this.richElement(middle);
      if (element && element.getBoundingClientRect().top <= screenY) left = middle;
      else right = middle - 1;
    }
    return left;
  }

  blockBox(pane, index) {
    const ranges = this.rich.parsed.ranges;
    const range = ranges[index];
    if (!range) return null;
    if (pane === 'source') {
      const top = this.sourceY(range.from);
      const next = ranges[index + 1];
      const view = this.source.view;
      const bottom = next ? this.sourceY(next.from) : view.documentTop + view.lineBlockAt(view.state.doc.length).bottom;
      return { top, bottom: Math.max(top + 1, bottom) };
    }
    const element = this.richElement(index);
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    const next = this.richElement(index + 1)?.getBoundingClientRect();
    return { top: bounds.top, bottom: Math.max(bounds.top + 1, next?.top ?? bounds.bottom) };
  }

  capture(pane) {
    const container = this.container(pane);
    const maximum = container.scrollHeight - container.clientHeight;
    if (container.scrollTop <= 1) return { edge: 'start' };
    if (maximum > 1 && container.scrollTop >= maximum - 1) return { edge: 'end' };
    const screenY = container.getBoundingClientRect().top + 2;
    const ranges = this.rich.parsed.ranges;
    let position;
    let index;
    let run;
    let coordinates;
    if (pane === 'source') {
      position = this.source.topPosition;
      index = this.sourceIndex(position);
      const range = ranges[index];
      const line = this.source.view.state.doc.lineAt(position);
      run = this.rich.parsed.runs.find(item => item.from <= position && item.to >= position && item.from >= range.from && item.to <= range.to);
      if (!run) {
        run = this.rich.parsed.runs.find(item => item.from >= position && item.from <= line.to && item.from >= range.from && item.to <= range.to);
        if (run) position = run.from;
      }
      if (run) coordinates = this.source.view.coordsAtPos(position);
    } else {
      index = this.richIndex(screenY);
      const range = ranges[index];
      const element = this.richElement(index);
      const bounds = element?.getBoundingClientRect();
      const left = bounds ? Math.max(bounds.left, this.rich.view.dom.getBoundingClientRect().left) + 4 : container.getBoundingClientRect().left + 30;
      const found = this.rich.view.posAtCoords({ left, top: screenY });
      if (found) {
        run = this.rich.parsed.runs.find(item => found.pos >= item.position && found.pos <= item.position + item.text.length && item.from >= range.from && item.to <= range.to);
        if (run) {
          position = run.from + found.pos - run.position;
          coordinates = this.rich.view.coordsAtPos(found.pos);
        }
      }
    }
    const range = ranges[index];
    const box = this.blockBox(pane, index);
    if (!box) return null;
    const anchor = { from: range.from, progress: clamp((screenY - box.top) / (box.bottom - box.top), 0, 1) };
    if (run && coordinates && screenY >= coordinates.top - 2 && screenY <= coordinates.bottom + 2) {
      anchor.text = position;
      anchor.lineProgress = clamp((screenY - coordinates.top) / Math.max(1, coordinates.bottom - coordinates.top), 0, 1);
    }
    return anchor;
  }

  apply(pane, anchor) {
    if (!this.visible(pane)) return false;
    const container = this.container(pane);
    let next;
    if (anchor.edge) next = anchor.edge === 'start' ? 0 : Math.max(0, container.scrollHeight - container.clientHeight);
    else {
      const index = this.sourceIndex(anchor.from);
      if (pane === 'rich' && anchor.text !== undefined) this.rich.tables?.ensure(this.rich.parsed.ranges[index].position + 1);
      const box = this.blockBox(pane, index);
      if (!box) return false;
      let screenY = box.top + (box.bottom - box.top) * anchor.progress;
      if (anchor.text !== undefined) {
        const run = this.rich.parsed.runs.find(item => anchor.text >= item.from && anchor.text <= item.to);
        if (run) {
          const coordinates = pane === 'source'
            ? this.source.view.coordsAtPos(clamp(anchor.text, 0, this.source.view.state.doc.length))
            : this.rich.view.coordsAtPos(run.position + anchor.text - run.from);
          if (coordinates) screenY = coordinates.top + (coordinates.bottom - coordinates.top) * anchor.lineProgress;
        }
      }
      next = clamp(container.scrollTop + screenY - container.getBoundingClientRect().top - 2 - container.clientHeight * (anchor.viewportFraction || 0), 0, Math.max(0, container.scrollHeight - container.clientHeight));
    }
    if (Math.abs(next - container.scrollTop) < 0.75) return false;
    container.scrollTop = next;
    this.expected.set(pane, container.scrollTop);
    return true;
  }

  synchronize() {
    if (!this.owner || (!this.enabled() && !this.navigating)) return;
    this.rich.flush();
    if (!this.rich.parsed.ranges.length) return;
    if (this.document !== this.rich.parsed.source) this.navigating = false;
    if (this.navigating) {
      const sourceChanged = this.apply('source', this.anchor);
      const richChanged = this.apply('rich', this.anchor);
      if ((sourceChanged || richChanged) && this.adjustments++ < 3) this.schedule();
      return;
    }
    if (!this.enabled()) return;
    const recapture = !this.navigating && (this.recapture || !this.anchor || this.document !== this.rich.parsed.source);
    this.recapture = false;
    if (recapture) this.anchor = this.capture(this.owner);
    this.document = this.rich.parsed.source;
    if (!this.anchor) return;
    if (!recapture) this.apply(this.owner, this.anchor);
    const changed = this.apply(this.owner === 'source' ? 'rich' : 'source', this.anchor);
    if (changed && this.adjustments++ < 3) this.schedule();
  }

  destroy() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    for (const dispose of this.listeners) dispose();
  }
}