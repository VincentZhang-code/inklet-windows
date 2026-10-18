export function resolveReadingPosition(point, { hash, sourceLength, headings, ranges }) {
  if (!point) return { edge: 'start' };
  if (hash && point.Hash === hash) {
    if (point.SourcePosition >= sourceLength && sourceLength > 0) return { edge: 'end' };
    const range = ranges.findLast(item => item.from <= point.SourcePosition);
    if (range) return { from: range.from, progress: point.BlockProgress || 0, ...(point.HasTextAnchor ? { text: point.SourcePosition, lineProgress: point.TextProgress || 0 } : {}) };
  }
  const matching = headings.filter(heading => heading.text === point.Heading && heading.level === point.HeadingLevel);
  const heading = matching[point.HeadingOccurrence || 0];
  return heading ? { from: heading.from, progress: 0 } : { edge: 'start' };
}

export class ReadingPositionTracker {
  constructor({ current, read, write, capture, available, onError, delay = 1000 }) {
    Object.assign(this, { current, read, write, capture, available, onError, delay });
    this.visits = new Map(); this.timer = null; this.suspended = false;
  }
  entry() {
    const document = this.current(); const entry = this.visits.get(document.id);
    return entry?.path === document.path ? entry : null;
  }
  async open() {
    clearTimeout(this.timer);
    const document = this.current();
    let entry = this.entry();
    if (entry) { this.available(entry.previous); return false; }
    entry = { path: document.path, previous: null, interacted: false, changed: false, sequence: 0 };
    this.visits.set(document.id, entry); this.available(null);
    if (document.path && /\.(md|markdown)$/i.test(document.path)) {
      try { entry.previous = await this.read(document.id); }
      catch (error) { this.onError(error); }
    }
    if (this.current().id === document.id && this.entry() === entry) this.available(entry.previous);
    return true;
  }
  intent() { const entry = this.entry(); if (entry && !this.suspended) entry.interacted = true; }
  suspend() { clearTimeout(this.timer); this.suspended = true; const entry = this.entry(); if (entry) entry.interacted = false; }
  moved() {
    const entry = this.entry();
    if (this.suspended || !entry?.interacted || !entry.path || !/\.(md|markdown)$/i.test(entry.path)) return;
    entry.changed = true; entry.sequence++;
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush().catch(this.onError), this.delay);
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    const entry = this.entry();
    if (!entry?.changed || this.suspended) return;
    const document = this.current(); const sequence = entry.sequence;
    const point = this.capture();
    if (!point) return;
    await this.write(document.id, point);
    if (entry.sequence === sequence) entry.changed = false;
  }
  forget(ids) { for (const id of ids) this.visits.delete(id); }
  get previous() { return this.entry()?.previous || null; }
}