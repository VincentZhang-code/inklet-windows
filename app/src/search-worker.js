import { searchText } from './search-engine.js';
let source = '';
let revision = 0;
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'document') { source = message.source; revision = message.revision; }
  if (message.type === 'change') {
    const change = message.change;
    source = source.slice(0, change.from) + change.insert + source.slice(change.to);
    revision = message.revision;
  }
  if (message.type === 'search') {
    const started = performance.now();
    const result = searchText(source, message.query, message.options);
    self.postMessage({ id: message.id, revision: message.revision ?? revision, ...result, duration: performance.now() - started });
  }
};