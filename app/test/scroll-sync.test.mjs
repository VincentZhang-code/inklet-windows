import test from 'node:test';
import assert from 'node:assert/strict';
import { ScrollSynchronizer } from '../src/scroll-sync.js';
import { ReadingPositionTracker, resolveReadingPosition } from '../src/reading-position.js';

test('reading locations restore text anchors or fall back to matching headings without old pixel offsets', () => {
  const context = { hash: 'current', sourceLength: 300, headings: [{ from: 20, text: 'Chapter', level: 2 }, { from: 200, text: 'Chapter', level: 2 }], ranges: [{ from: 0 }, { from: 20 }, { from: 100 }, { from: 200 }] };
  const point = { Hash: 'current', SourcePosition: 120, HasTextAnchor: true, TextProgress: 0.25, BlockProgress: 0.4, Heading: 'Chapter', HeadingLevel: 2, HeadingOccurrence: 1, FallbackScrollTop: 99999 };
  assert.deepEqual(resolveReadingPosition(point, context), { from: 100, progress: 0.4, text: 120, lineProgress: 0.25 });
  assert.deepEqual(resolveReadingPosition({ ...point, Hash: 'old' }, context), { from: 200, progress: 0 });
  assert.deepEqual(resolveReadingPosition({ ...point, Hash: 'old', Heading: 'Missing' }, context), { edge: 'start' });
  assert.deepEqual(resolveReadingPosition({ ...point, SourcePosition: 300 }, context), { edge: 'end' });
  assert.deepEqual(resolveReadingPosition(null, context), { edge: 'start' });
});

test('reading tracker preserves the previous target while independently writing this visit', async () => {
  let current = { id: 'first', path: 'C:/first.md' };
  let point = { SourcePosition: 100 };
  const stored = { SourcePosition: 240 };
  const writes = [];
  const tracker = new ReadingPositionTracker({ current: () => current, read: async () => stored, write: async (id, position) => writes.push({ id, position }), capture: () => point, available: () => {}, onError: error => { throw error; } });
  assert.equal(await tracker.open(), true);
  tracker.moved(); await tracker.flush(); assert.equal(writes.length, 0);
  tracker.intent(); tracker.moved(); await tracker.flush();
  assert.equal(writes[0].position.SourcePosition, 100);
  assert.equal(tracker.previous.SourcePosition, 240);
  tracker.suspend(); point = { SourcePosition: 0 }; tracker.moved(); await tracker.flush();
  assert.equal(writes.length, 1);
  tracker.suspended = false;
  tracker.moved(); await tracker.flush(); assert.equal(writes.length, 1);
  assert.equal(await tracker.open(), false);
  current = { id: 'second', path: 'C:/second.md' }; await tracker.open();
  tracker.moved(); await tracker.flush(); assert.equal(writes.length, 1);
  tracker.intent(); tracker.moved(); await tracker.flush(); assert.equal(writes[1].id, 'second');
  tracker.forget(['first']); current = { id: 'first', path: 'C:/first.md' }; assert.equal(await tracker.open(), true);
});

test('layout feedback cannot reset the frame budget indefinitely', () => {
  const original = globalThis.requestAnimationFrame;
  const pending = [];
  globalThis.requestAnimationFrame = callback => { pending.push(callback); return pending.length; };
  try {
    const synchronizer = Object.create(ScrollSynchronizer.prototype);
    Object.assign(synchronizer, { frame: null, framesRemaining: 8, lastFrameAt: performance.now(), owner: 'source', enabled: () => true });
    let frames = 0;
    synchronizer.synchronize = () => { frames++; synchronizer.refresh(); };
    synchronizer.schedule();
    while (pending.length && frames < 100) pending.shift()();
    assert.equal(frames, 8);
    assert.equal(pending.length, 0);
    synchronizer.lastFrameAt = performance.now() - 201;
    synchronizer.refresh();
    assert.equal(pending.length, 1);
  } finally {
    if (original) globalThis.requestAnimationFrame = original;
    else delete globalThis.requestAnimationFrame;
  }
});