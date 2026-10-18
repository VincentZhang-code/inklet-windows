import { minimalChange } from './document.mjs';

export class RecoveryWriter {
  constructor({ snapshot, write, onState = () => {}, onError = () => {}, delay = 250 }) {
    this.snapshot = snapshot;
    this.write = write;
    this.onState = onState;
    this.onError = onError;
    this.delay = delay;
    this.generation = 0;
    this.base = null;
    this.pending = false;
    this.timer = null;
    this.job = null;
    this.state = 'idle';
  }

  status(value) { this.state = value; this.onState(value); }

  schedule() {
    this.pending = true;
    if (this.state !== 'error') this.status('pending');
    if (!this.timer && !this.job) this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.state === 'error' ? 2000 : this.delay);
  }

  reset() {
    clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
    this.base = null;
    this.generation++;
    this.status('idle');
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.job) return this.job.then(() => this.pending ? this.flush() : undefined);
    const snapshot = this.snapshot();
    this.pending = false;
    if (!snapshot) return Promise.resolve();
    if (this.base?.documentId === snapshot.documentId && this.base?.revision === snapshot.revision) {
      this.status('protected');
      return Promise.resolve();
    }
    const generation = this.generation;
    this.status('writing');
    this.job = (async () => {
      let acknowledgement;
      if (this.base?.documentId === snapshot.documentId) {
        const { text, ...metadata } = snapshot;
        acknowledgement = await this.write('draftDelta', { ...metadata, baseRevision: this.base.revision, change: minimalChange(this.base.text, text) });
      }
      if (!acknowledgement || acknowledgement.needsSnapshot) acknowledgement = await this.write('draft', snapshot);
      if (!acknowledgement?.persisted || acknowledgement.documentId !== snapshot.documentId || acknowledgement.revision !== snapshot.revision) throw new Error('Recovery write was not acknowledged');
      if (generation === this.generation) {
        this.base = snapshot;
        this.status(this.pending ? 'pending' : 'protected');
      }
    })().catch(error => {
      if (generation === this.generation) { this.status('error'); this.onError(error); }
      throw error;
    }).finally(() => {
      this.job = null;
      if (this.pending && this.state !== 'error') this.schedule();
    });
    return this.job;
  }
}