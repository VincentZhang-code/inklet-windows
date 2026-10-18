import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryWriter } from './recovery.mjs';

test('first recovery is a snapshot, later input is an acknowledged delta', async () => {
  let current = { documentId: 'one', revision: 1, text: 'hello' };
  const calls = [];
  const writer = new RecoveryWriter({ snapshot: () => current, write: async (type, payload) => { calls.push({ type, payload }); return { persisted: true, documentId: payload.documentId, revision: payload.revision }; } });
  await writer.flush();
  assert.equal(writer.state, 'protected');
  current = { ...current, revision: 2, text: 'hello world' };
  await writer.flush();
  assert.deepEqual(calls.map(call => call.type), ['draft', 'draftDelta']);
  assert.deepEqual(calls[1].payload.change, { from: 5, to: 5, insert: ' world' });
});

test('a lost backend baseline requests a full snapshot without losing input', async () => {
  let current = { documentId: 'one', revision: 1, text: 'one' };
  const calls = [];
  const writer = new RecoveryWriter({ snapshot: () => current, write: async (type, payload) => {
    calls.push(type);
    return type === 'draftDelta' ? { needsSnapshot: true } : { persisted: true, documentId: payload.documentId, revision: payload.revision };
  } });
  await writer.flush();
  current = { ...current, revision: 2, text: 'two' };
  await writer.flush();
  assert.deepEqual(calls, ['draft', 'draftDelta', 'draft']);
  assert.equal(writer.base.text, 'two');
});

test('continuous input does not postpone the scheduled recovery write', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let writes = 0;
  const snapshot = { documentId: 'one', revision: 1, text: 'input' };
  const writer = new RecoveryWriter({ snapshot: () => snapshot, write: async () => { writes++; return { persisted: true, ...snapshot }; } });
  writer.schedule();
  for (let count = 0; count < 5; count++) { context.mock.timers.tick(40); writer.schedule(); }
  context.mock.timers.tick(50);
  await writer.job;
  assert.equal(writes, 1);
  assert.equal(writer.state, 'protected');
});

test('failed or stale acknowledgements never claim that data is protected', async () => {
  const writer = new RecoveryWriter({ snapshot: () => ({ documentId: 'one', revision: 2, text: 'input' }), write: async () => ({ persisted: true, documentId: 'one', revision: 1 }) });
  await assert.rejects(writer.flush());
  assert.equal(writer.state, 'error');
  let finish;
  writer.write = () => new Promise(resolve => { finish = resolve; });
  const pending = writer.flush();
  writer.reset();
  finish({ persisted: true, documentId: 'one', revision: 2 });
  await pending;
  assert.equal(writer.state, 'idle');
  assert.equal(writer.base, null);
});