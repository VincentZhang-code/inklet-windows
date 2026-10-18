import test from 'node:test';
import assert from 'node:assert/strict';
import { codeSpans, codePalette, normalizeLanguage, prepareCodeHighlighting, onCodeHighlightingReady } from '../src/code-highlighting.js';

test('highlighter loads only when needed and notifies waiting views once', async () => {
  assert.deepEqual(codeSpans('plain text', 'plaintext'), []);
  let notifications = 0;
  const dispose = onCodeHighlightingReady(() => notifications++);
  const first = prepareCodeHighlighting();
  assert.equal(first, prepareCodeHighlighting());
  await first;
  assert.equal(notifications, 1);
  dispose();
  await prepareCodeHighlighting();
  assert.equal(notifications, 1);
});

test('common language keywords are parsed with exact source ranges', async () => {
  await prepareCodeHighlighting();
  for (const [language, text, keyword] of [['js', 'const value = 1;', 'const'], ['py', 'def hello():\n    return "yes"', 'def'], ['sql', 'SELECT name FROM users', 'SELECT']]) {
    const spans = codeSpans(text, language);
    assert.ok(spans.some(span => span.className.includes('hljs-keyword') && text.slice(span.from, span.to) === keyword));
  }
});

test('per-language colors override global colors without accepting CSS injection', () => {
  const settings = { default: { keyword: '#112233' }, python: { keyword: '#AABBCC', comment: 'red;display:none' } };
  assert.equal(codePalette('py', settings).keyword, '#AABBCC');
  assert.equal(codePalette('js', settings).keyword, '#112233');
  assert.ok(/^#[0-9A-F]{6}$/i.test(codePalette('python', settings).comment));
  assert.equal(normalizeLanguage('typescript title'), 'typescript');
});

test('unknown or oversized code remains intact without unsafe HTML generation', () => {
  assert.deepEqual(codeSpans('<script>alert(1)</script>', 'unknown'), []);
  assert.deepEqual(codeSpans('const x = 1;'.repeat(20000), 'javascript'), []);
});