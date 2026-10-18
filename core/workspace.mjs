import { DocumentSession, restoreHighlights, serializeHighlights } from './document.mjs';

export function createDocumentState(data, restored = data.restored === true) {
  const session = new DocumentSession(data.text || '');
  Object.assign(session, restoreHighlights(session.source, data.annotations?.marks, !!data.hash && data.annotations?.textHash === data.hash));
  return {
    session,
    info: { name: data.name || 'Untitled.md', path: data.path || null, hash: data.hash || null },
    savedRevision: restored ? -1 : 0,
    selection: { from: 0, to: 0 },
    view: null,
    search: { query: '', replacement: '' },
  };
}

export function stateBytes(state) {
  if (!state) return 0;
  let bytes = state.session.source.length * 2 + 1024;
  for (const entry of [...state.session.past, ...state.session.future]) {
    bytes += 256;
    for (const change of [entry.change, entry.inverse, ...(entry.changes || []), ...(entry.inverseChanges || [])]) bytes += (change?.insert?.length || 0) * 2 + 64;
    bytes += ((entry.beforeMarks?.length || 0) + (entry.afterMarks?.length || 0)) * 160;
  }
  return bytes + (state.session.highlights.length + state.session.unresolved.length) * 320;
}

export class DocumentWorkspace {
  constructor({ load, write, read, beforeActivate = async () => {}, byteBudget = 16 * 1024 * 1024, residentLimit = 3 }) {
    this.load = load;
    this.write = write;
    this.read = read;
    this.beforeActivate = beforeActivate;
    this.byteBudget = byteBudget;
    this.residentLimit = residentLimit;
    this.entries = new Map();
    this.activeId = null;
    this.clock = 0;
    this.switching = false;
  }

  get active() { return this.entries.get(this.activeId) || null; }

  add(info, state = null) {
    if (!info?.id || typeof info.id !== 'string') throw new Error('Document identity is required');
    const existing = this.entries.get(info.id);
    if (existing) return existing;
    const entry = { id: info.id, info: { ...info }, state, stored: false, dirty: !!state && state.savedRevision !== state.session.revision, used: ++this.clock, changedExternally: false };
    this.entries.set(entry.id, entry);
    return entry;
  }

  snapshot(entry) {
    if (!entry.state) throw new Error('Document is not resident');
    const session = entry.state.session;
    return { version: 1, documentId: entry.id, ...entry.state, session: session.snapshot(), annotations: { version: 1, marks: [...serializeHighlights(session.source, session.highlights), ...session.unresolved] } };
  }

  async activate(id) {
    if (this.switching) throw new Error('A document switch is already in progress');
    const target = this.entries.get(id);
    if (!target) throw new Error('Document is closed');
    if (id === this.activeId && target.state) return target;
    this.switching = true;
    try {
      let state = target.state;
      if (!state && target.stored) {
        const saved = await this.read(target.id);
        if (saved?.version !== 1 || saved.documentId !== target.id) throw new Error('Stored document identity mismatch');
        state = { ...saved, session: DocumentSession.restore(saved.session) };
      }
      if (!state) state = createDocumentState(await this.load(target));
      const residents = [...this.entries.values()].filter(entry => entry.id !== id && entry.state).sort((first, second) => first.used - second.used);
      let bytes = stateBytes(state) + residents.reduce((total, entry) => total + stateBytes(entry.state), 0);
      let count = residents.length + 1;
      const evictions = [];
      for (const entry of residents) {
        if (bytes <= this.byteBudget && count <= this.residentLimit) break;
        if (entry.pinned) continue;
        const snapshot = this.snapshot(entry);
        const acknowledgement = await this.write(entry.id, snapshot);
        if (acknowledgement?.documentId !== entry.id || acknowledgement?.revision !== entry.state.session.revision || acknowledgement?.persisted !== true) throw new Error('Session storage was not acknowledged');
        evictions.push(entry);
        bytes -= stateBytes(entry.state);
        count--;
      }
      await this.beforeActivate(id);
      for (const entry of evictions) {
        entry.info = { ...entry.info, ...entry.state.info };
        entry.dirty = entry.state.savedRevision !== entry.state.session.revision;
        entry.state = null;
        entry.stored = true;
      }
      target.state = state;
      target.info = { ...target.info, ...state.info };
      target.used = ++this.clock;
      this.activeId = id;
      return target;
    } finally { this.switching = false; }
  }

  remove(id) {
    if (id === this.activeId) this.activeId = null;
    return this.entries.delete(id);
  }

  get residentBytes() { return [...this.entries.values()].reduce((total, entry) => total + stateBytes(entry.state), 0); }
}