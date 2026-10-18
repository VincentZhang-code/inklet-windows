export const highlightColors = {
  yellow: '#F4CE46',
  green: '#82C895',
  blue: '#72B8EC',
  pink: '#EC9CB4',
  orange: '#EFA464',
};

export function replaceText(source, change) {
  const { from, to, insert } = change;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > source.length || typeof insert !== 'string') {
    throw new RangeError('Invalid document change');
  }
  return source.slice(0, from) + insert + source.slice(to);
}

export function minimalChange(before, after) {
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > from && endAfter > from && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  return { from, to: endBefore, insert: after.slice(from, endAfter) };
}

export function mapHighlights(highlights, change) {
  const delta = change.insert.length - (change.to - change.from);
  const mapPosition = (position, association) => {
    if (position < change.from || (position === change.from && association < 0)) return position;
    if (position > change.to || (position === change.to && association > 0)) return position + delta;
    return change.from + (association > 0 ? change.insert.length : 0);
  };
  return highlights.map(mark => ({
    ...mark,
    from: mapPosition(mark.from, 1),
    to: mapPosition(mark.to, -1),
  })).filter(mark => mark.from < mark.to);
}

export function paintHighlights(highlights, from, to, color, opacity = 0.3) {
  if (to <= from) return highlights;
  const output = [];
  for (const mark of highlights) {
    if (mark.to <= from || mark.from >= to) output.push(mark);
    else {
      if (mark.from < from) output.push({ ...mark, to: from });
      if (mark.to > to) output.push({ ...mark, from: to });
    }
  }
  if (color && highlightColors[color]) output.push({ from, to, color, opacity: Math.max(0.15, Math.min(0.5, opacity)) });
  return output.sort((first, second) => first.from - second.from);
}

export function serializeHighlights(source, highlights) {
  return highlights.map(mark => ({
    ...mark,
    quote: source.slice(mark.from, mark.to),
    prefix: source.slice(Math.max(0, mark.from - 32), mark.from),
    suffix: source.slice(mark.to, mark.to + 32),
  }));
}

export function restoreHighlights(source, saved, unchanged = false) {
  const highlights = [];
  const unresolved = [];
  for (const mark of Array.isArray(saved) ? saved : []) {
    if (!mark || !highlightColors[mark.color] || typeof mark.quote !== 'string' || !mark.quote) continue;
    const opacity = Math.max(0.15, Math.min(0.5, Number(mark.opacity) || 0.3));
    if (unchanged && source.slice(mark.from, mark.to) === mark.quote) {
      highlights.push({ from: mark.from, to: mark.to, color: mark.color, opacity });
      continue;
    }
    const candidates = [];
    let position = source.indexOf(mark.quote);
    while (position >= 0) {
      const prefixMatches = !mark.prefix || source.slice(Math.max(0, position - mark.prefix.length), position) === mark.prefix;
      const suffixMatches = !mark.suffix || source.slice(position + mark.quote.length, position + mark.quote.length + mark.suffix.length) === mark.suffix;
      if (prefixMatches && suffixMatches) candidates.push(position);
      if (candidates.length > 1) break;
      position = source.indexOf(mark.quote, position + 1);
    }
    if (candidates.length === 1) highlights.push({ from: candidates[0], to: candidates[0] + mark.quote.length, color: mark.color, opacity });
    else unresolved.push(mark);
  }
  return { highlights, unresolved };
}

export class DocumentSession {
  constructor(source = '') {
    this.source = source;
    this.highlights = [];
    this.unresolved = [];
    this.past = [];
    this.future = [];
    this.revision = 0;
  }

  snapshot() {
    return { source: this.source, highlights: this.highlights, unresolved: this.unresolved, past: this.past, future: this.future, revision: this.revision };
  }

  static restore(snapshot) {
    if (!snapshot || typeof snapshot.source !== 'string' || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 ||
      !['highlights', 'unresolved', 'past', 'future'].every(key => Array.isArray(snapshot[key]))) throw new Error('Invalid document session');
    return Object.assign(new DocumentSession(), snapshot);
  }

  replace(change, { record = true } = {}) {
    const previous = this.source;
    const next = replaceText(previous, change);
    if (previous === next) return false;
    const beforeMarks = this.highlights;
    const afterMarks = mapHighlights(beforeMarks, change);
    if (record) this.record({
      change,
      inverse: { from: change.from, to: change.from + change.insert.length, insert: previous.slice(change.from, change.to) },
      beforeMarks,
      afterMarks,
    });
    this.source = next;
    this.highlights = afterMarks;
    this.revision++;
    return true;
  }

  paint(from, to, color, opacity) {
    if (from < 0 || to > this.source.length || to <= from) return false;
    const beforeMarks = this.highlights;
    const afterMarks = paintHighlights(beforeMarks, from, to, color, opacity);
    if (JSON.stringify(beforeMarks) === JSON.stringify(afterMarks)) return false;
    this.record({ beforeMarks, afterMarks });
    this.highlights = afterMarks;
    this.revision++;
    return true;
  }

  replaceBatch(changes, restoredAnnotations = null) {
    const ordered = [...changes].sort((first, second) => second.from - first.from);
    const inverseChanges = [];
    const beforeMarks = this.highlights;
    let source = this.source;
    let marks = beforeMarks;
    let boundary = source.length;
    for (const change of ordered) {
      if (change.to > boundary) throw new RangeError('Overlapping document changes');
      inverseChanges.unshift({ from: change.from, to: change.from + change.insert.length, insert: source.slice(change.from, change.to) });
      source = replaceText(source, change);
      marks = mapHighlights(marks, change);
      boundary = change.from;
    }
    if (source === this.source) return false;
    const afterMarks = restoredAnnotations?.highlights || marks;
    const afterUnresolved = restoredAnnotations?.unresolved || this.unresolved;
    this.record({ changes: ordered, inverseChanges, beforeMarks, afterMarks, beforeUnresolved: this.unresolved, afterUnresolved });
    this.source = source;
    this.highlights = afterMarks;
    this.unresolved = afterUnresolved;
    this.revision++;
    return true;
  }

  record(entry) {
    this.past.push(entry);
    if (this.past.length > 300) this.past.shift();
    this.future = [];
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return false;
    if (entry.inverse) this.source = replaceText(this.source, entry.inverse);
    if (entry.inverseChanges) for (const change of entry.inverseChanges) this.source = replaceText(this.source, change);
    this.highlights = entry.beforeMarks;
    if (entry.beforeUnresolved) this.unresolved = entry.beforeUnresolved;
    this.future.push(entry);
    this.revision++;
    return true;
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return false;
    if (entry.change) this.source = replaceText(this.source, entry.change);
    if (entry.changes) for (const change of entry.changes) this.source = replaceText(this.source, change);
    this.highlights = entry.afterMarks;
    if (entry.afterUnresolved) this.unresolved = entry.afterUnresolved;
    this.past.push(entry);
    this.revision++;
    return true;
  }
}