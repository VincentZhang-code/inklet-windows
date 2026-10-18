import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFromEvent, commandFromEvent, validateShortcuts } from './shortcuts.mjs';

test('custom shortcut replaces the default in both editing modes', () => {
  const key = { key: 's', code: 'KeyS', ctrlKey: true };
  assert.equal(commandFromEvent(key), 'save');
  assert.equal(commandFromEvent(key, { save: 'Ctrl+Alt+S' }), null);
  assert.equal(commandFromEvent({ ...key, altKey: true }, { save: 'Ctrl+Alt+S' }), 'save');
});

test('duplicate, unsafe and bare character bindings are rejected', () => {
  assert.equal(validateShortcuts({ save: 'Ctrl+O' }).reason, 'duplicate');
  assert.equal(validateShortcuts({ save: 'Ctrl+C' }).reason, 'reserved');
  assert.equal(validateShortcuts({ save: 'A' }).reason, 'modifier');
  assert.equal(validateShortcuts({ save: 'Ctrl+Alt+S' }), null);
  assert.equal(validateShortcuts({ save: '' }), null);
});

test('IME composition and modifier-only events never trigger commands', () => {
  assert.equal(shortcutFromEvent({ key: 's', code: 'KeyS', ctrlKey: true, isComposing: true }), '');
  assert.equal(shortcutFromEvent({ key: 'Control', ctrlKey: true }), '');
  assert.equal(commandFromEvent({ key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true }), 'redo');
});