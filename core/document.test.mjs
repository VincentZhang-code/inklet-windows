import test from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession, minimalChange, replaceText, mapHighlights, paintHighlights, serializeHighlights, restoreHighlights } from './document.mjs';
import { DocumentWorkspace, createDocumentState } from './workspace.mjs';

test('minimal edits preserve all unrelated Markdown bytes', () => {
  const before = '# Title\r\n\r\n*italic*  \r\n\r\n| a | b |\r\n|---|---|\r\n';
  const after = before.replace('italic', 'edited');
  const change = minimalChange(before, after);
  assert.equal(replaceText(before, change), after);
  assert.equal(change.from, before.indexOf('italic'));
});

test('invalid source ranges cannot corrupt the document', () => {
  assert.throws(() => replaceText('abc', { from: 3, to: 1, insert: '' }), RangeError);
});

test('annotation boundaries exclude adjacent insertion and include inner insertion', () => {
  const marks = [{ from: 3, to: 6, color: 'blue', opacity: 0.3 }];
  assert.deepEqual(mapHighlights(marks, { from: 3, to: 3, insert: 'xx' })[0], { ...marks[0], from: 5, to: 8 });
  assert.equal(mapHighlights(marks, { from: 6, to: 6, insert: 'xx' })[0].to, 6);
  assert.equal(mapHighlights(marks, { from: 4, to: 4, insert: 'xx' })[0].to, 8);
});

test('deleted highlights disappear and undo restores both text and marks', () => {
  const document = new DocumentSession('one two three');
  document.paint(4, 7, 'yellow', 0.3);
  document.replace({ from: 4, to: 7, insert: '' });
  assert.equal(document.highlights.length, 0);
  assert.equal(document.source, 'one  three');
  document.undo();
  assert.equal(document.source, 'one two three');
  assert.equal(document.highlights.length, 1);
  document.undo();
  assert.equal(document.highlights.length, 0);
  document.redo();
  assert.equal(document.highlights.length, 1);
});

test('recolor and clear split existing marks without stacking colors', () => {
  const initial = [{ from: 0, to: 10, color: 'yellow', opacity: 0.3 }];
  const colored = paintHighlights(initial, 3, 7, 'blue');
  assert.deepEqual(colored.map(mark => [mark.from, mark.to, mark.color]), [[0, 3, 'yellow'], [3, 7, 'blue'], [7, 10, 'yellow']]);
  assert.equal(paintHighlights(colored, 0, 10, null).length, 0);
});

test('external edits relocate only unambiguous annotations', () => {
  const saved = serializeHighlights('before target after', [{ from: 7, to: 13, color: 'pink', opacity: 0.3 }]);
  assert.equal(restoreHighlights('new before target after', saved).highlights[0].from, 11);
  assert.equal(restoreHighlights('before target after before target after', saved).unresolved.length, 1);
});

test('Chinese and astral characters retain consistent UTF-16 positions', () => {
  const source = '\u58a8\u70b9\ud83d\udcdd\u7f16\u8f91';
  const document = new DocumentSession(source);
  document.paint(4, 6, 'green');
  document.replace({ from: 0, to: 0, insert: '\u4f60\u597d' });
  assert.equal(document.source.slice(document.highlights[0].from, document.highlights[0].to), '\u7f16\u8f91');
  document.undo();
  assert.equal(document.source, source);
});

test('replace all keeps intervening highlights and forms one undo step', () => {
  const document = new DocumentSession('cat IMPORTANT cat');
  document.paint(4, 13, 'blue');
  document.replaceBatch([{ from: 0, to: 3, insert: 'kitten' }, { from: 14, to: 17, insert: 'kitten' }]);
  assert.equal(document.source, 'kitten IMPORTANT kitten');
  assert.equal(document.source.slice(document.highlights[0].from, document.highlights[0].to), 'IMPORTANT');
  document.undo();
  assert.equal(document.source, 'cat IMPORTANT cat');
  document.redo();
  assert.equal(document.source, 'kitten IMPORTANT kitten');
});

test('prepared image changes keep annotation relocation undoable with the document', () => {
  const document = new DocumentSession('marked image.png');
  document.paint(0, 6, 'blue');
  const original = document.highlights;
  document.replaceBatch([{ from: 7, to: 16, insert: 'data:image/png;base64,AQID' }], { highlights: original, unresolved: [{ quote: 'old note', color: 'blue' }] });
  assert.equal(document.unresolved.length, 1);
  document.undo(); assert.equal(document.source, 'marked image.png'); assert.equal(document.unresolved.length, 0);
  assert.deepEqual(document.highlights, original);
  document.redo(); assert.equal(document.unresolved.length, 1); assert.ok(document.source.includes('data:image/png'));
});

test('workspace cold sessions retain independent text, marks, undo and reading position', async () => {
  const storage = new Map();
  const workspace = new DocumentWorkspace({
    residentLimit: 1,
    load: async entry => ({ name: entry.id + '.md', text: entry.id }),
    write: async (id, snapshot) => { storage.set(id, JSON.stringify(snapshot)); return { persisted: true, documentId: id, revision: snapshot.session.revision }; },
    read: async id => JSON.parse(storage.get(id)),
  });
  workspace.add({ id: 'first' }); workspace.add({ id: 'second' });
  const first = await workspace.activate('first');
  first.state.session.paint(0, 3, 'blue', 0.3);
  first.state.session.replace({ from: 0, to: 0, insert: 'new ' });
  first.state.selection = { from: 4, to: 7 }; first.state.view = { sourceTop: 120, richTop: 220 };
  const second = await workspace.activate('second');
  assert.equal(first.state, null);
  assert.equal(first.dirty, true);
  assert.equal(second.state.session.source, 'second');
  const recovered = await workspace.activate('first');
  assert.equal(recovered.state.session.source, 'new first');
  assert.deepEqual(recovered.state.selection, { from: 4, to: 7 });
  assert.equal(recovered.state.view.richTop, 220);
  recovered.state.session.undo();
  assert.equal(recovered.state.session.source, 'first');
  assert.equal(recovered.state.session.highlights.length, 1);
  recovered.state.session.redo();
  assert.equal(recovered.state.session.source, 'new first');
  assert.equal(second.state, null);
});

test('workspace refuses an unacknowledged eviction without changing the active document', async () => {
  const workspace = new DocumentWorkspace({ residentLimit: 1, load: async entry => ({ text: entry.id }), write: async () => ({ persisted: false }) });
  const first = workspace.add({ id: 'first' }, createDocumentState({ text: 'unsaved' }, true));
  workspace.add({ id: 'second' });
  await workspace.activate('first');
  await assert.rejects(workspace.activate('second'), /not acknowledged/);
  assert.equal(workspace.active, first);
  assert.equal(first.state.session.source, 'unsaved');
  assert.equal(workspace.entries.get('second').state, null);
});

test('workspace loads lazily, deduplicates identities and bounds resident sessions', async () => {
  let loaded = 0;
  const storage = new Map();
  const workspace = new DocumentWorkspace({
    byteBudget: 4500,
    load: async entry => { loaded++; return { text: entry.id.repeat(300) }; },
    write: async (id, snapshot) => { storage.set(id, structuredClone(snapshot)); return { persisted: true, documentId: id, revision: snapshot.session.revision }; },
    read: async id => storage.get(id),
  });
  for (let index = 0; index < 30; index++) workspace.add({ id: 'file-' + index });
  workspace.add({ id: 'file-0' });
  assert.equal(loaded, 0); assert.equal(workspace.entries.size, 30);
  for (let index = 0; index < 100; index++) await workspace.activate('file-' + index % 30);
  assert.equal(loaded, 30);
  assert.equal([...workspace.entries.values()].filter(entry => entry.state).length, 1);
  assert.equal(workspace.active.id, 'file-9');
  assert.equal(workspace.residentBytes, 4624);
});