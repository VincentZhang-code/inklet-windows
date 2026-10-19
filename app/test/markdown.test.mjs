import { embedDocumentImages } from '../src/embedded-images.js';
import { isImagePlaceholder } from '../src/image-references.js';

test('explicit image placeholders are preserved without reading files', async () => {
  const reference = '\u5360\u4f4d\uff1aMD\u8f6cWord\u65f6\u63d2\u5165';
  const source = '![Prototype](' + reference + ')\n\n![Another](placeholder:later)\n';
  const result = await embedDocumentImages(source, { readAsset: async () => { throw new Error('Placeholder must not be read'); } });
  assert.equal(result.source, source);
  assert.equal(result.placeholders, 2);
  assert.deepEqual(result.issues, []);
  assert.equal(isImagePlaceholder(encodeURIComponent(reference)), true);
  assert.equal(isImagePlaceholder('images/placeholder.png'), false);
});

test('confirmed missing images preserve references while valid images are embedded', async () => {
  const source = '# Keep\n\n![Good](good.png)\n\n![Missing](missing.png)\n\n![Again](missing.png)\n\n![Later](placeholder:later)\n';
  const reads = [];
  const result = await embedDocumentImages(source, { allowMissingImages: true, readAsset: async reference => {
    reads.push(reference);
    if (reference === 'missing.png') throw new Error('File is missing');
    return { mime: 'image/png', data: 'AQID' };
  } });
  assert.deepEqual(reads, ['good.png', 'missing.png']);
  assert.equal(result.images, 1);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].path, 'missing.png');
  assert.equal(result.source, source.replace('good.png', 'data:image/png;base64,AQID'));
});

test('embedding failures decode paths and permit opt-in reference retention without bypassing document size limits', async () => {
  const source = '![Picture](broken%20image.png)';
  const result = await embedDocumentImages(source, { allowMissingImages: true, readAsset: async () => { throw new Error('Cannot decode'); } });
  assert.equal(result.issues[0].displayPath, 'broken image.png');
  assert.equal(result.source, source);
  const oversized = await embedDocumentImages('![A](a.png)', { allowMissingImages: true, maxBytes: 32, readAsset: async () => ({ mime: 'image/png', data: 'AQID'.repeat(30) }) });
  assert.equal(oversized.images, 0);
  assert.equal(oversized.issues.length, 1);
  await assert.rejects(embedDocumentImages('A'.repeat(100), { maxBytes: 32, allowMissingImages: true }), /上限/);
});

test('embedded image conversion leaves unrelated Markdown and image examples untouched', async () => {
  const source = '# Untouched *heading*\n\nA paragraph with **formatting**.\n\n![Picture](../images/picture.png)\n\n```md\n![Example](not-a-file.png)\n```\n\nEnd  \n';
  let reads = 0;
  const result = await embedDocumentImages(source, { readAsset: async reference => { reads++; assert.equal(reference, '../images/picture.png'); return { mime: 'image/png', data: 'AQID' }; } });
  assert.equal(reads, 1);
  assert.ok(result.source.startsWith('# Untouched *heading*\n\nA paragraph with **formatting**.\n\n'));
  assert.ok(result.source.includes('data:image/png;base64,AQID'));
  assert.ok(result.source.endsWith('```md\n![Example](not-a-file.png)\n```\n\nEnd  \n'));
  assert.equal(result.changes.length, 1);
});

test('embedded images reuse file reads and fail atomically on missing images or excessive size', async () => {
  let reads = 0;
  const source = '![A](a.png)\n\n![B](a.png)\n\n![Existing](data:image/png;base64,AQID)';
  const result = await embedDocumentImages(source, { readAsset: async () => { reads++; return { mime: 'image/png', data: 'AQID' }; } });
  assert.equal(reads, 1);
  assert.equal(result.images, 1);
  assert.equal((result.source.match(/data:image\/png;base64,AQID/g) || []).length, 3);
  await assert.rejects(embedDocumentImages('![A](missing.png)', { readAsset: async () => { throw new Error('missing'); } }), /missing/);
  await assert.rejects(embedDocumentImages('![A](a.png)', { maxBytes: 32, readAsset: async () => ({ mime: 'image/png', data: 'AQID'.repeat(30) }) }), /24MiB/);
});

test('embedded image conversion supports references, Windows paths and HTML table images without losing nodes', async () => {
  const source = '# Retained\n\n![Ref][picture]\n\n[picture]: file:///C:/images/a.png\n\n![Drive](C:/images/b.png)\n\n<table><tr><td><img src="../c.png" alt="Cell"></td></tr></table>\n';
  const result = await embedDocumentImages(source, { readAsset: async () => ({ mime: 'image/png', data: 'AQID' }) });
  const images = [];
  parseDocument(result.source).doc.descendants(node => { if (node.type.name === 'image') images.push(node.attrs.src); });
  assert.equal(images.length, 3);
  assert.ok(images.every(value => value === 'data:image/png;base64,AQID'));
  assert.ok(result.source.includes('[picture]: file:///C:/images/a.png'));
  assert.ok(result.source.startsWith('# Retained\n\n'));
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorState } from 'prosemirror-state';
import { parseDocument, richChange, plainTextChange, schema, serializer, sourcePosition, prosePosition, imageInsertion, wordStatistics, documentHeadings } from '../src/markdown.js';
import { DocumentSession, replaceText } from '../../core/document.mjs';
import { quoteFlowchartLabels } from '../src/renderers.js';
import { tableColumnWidths } from '../src/table-layout.js';

test('alphabetic lines retain visible source breaks without becoming numeric lists', () => {
  const source = 'A. **Load**: call `ListItems`.\nB. **Search**: keep filters.\nC. **Save**: preserve text.';
  const parsed = parseDocument(source);
  const breaks = [];
  parsed.doc.descendants(node => { if (node.type.name === 'hard_break') breaks.push(node.attrs.soft); });
  assert.equal(parsed.doc.firstChild.type.name, 'paragraph');
  assert.deepEqual(breaks, [true, true]);
  assert.equal(serializer.serialize(parsed.doc), source);
});

test('source breaks keep edited lines and leave ordinary numbered lists and code unchanged', () => {
  const source = 'A. First\nB. Second\nC. Third\n\n1. One\n2. Two\n\n```text\nA. Code\nB. Code\n```\n';
  const parsed = parseDocument(source);
  const position = parsed.doc.firstChild.textContent.indexOf('First') + 1;
  const next = EditorState.create({ doc: parsed.doc }).tr.insertText('Changed', position, position + 5).doc;
  const change = richChange(source, parsed.doc, next, parsed.ranges);
  assert.equal(replaceText(source, change), source.replace('First', 'Changed'));
  assert.equal(parsed.doc.child(1).type.name, 'ordered_list');
  assert.equal(parsed.doc.child(2).type.name, 'code_block');
  assert.equal(parsed.doc.child(2).textContent, 'A. Code\nB. Code');
});

test('valid leading YAML front matter becomes one property-table node', () => {
  const source = '---\nname: html-offline-bundler\ndescription: "Makes CDN prototypes work offline"\ntags: [html, offline]\n---\n\n# Guide\n';
  const parsed = parseDocument(source);
  assert.equal(parsed.doc.firstChild.type.name, 'front_matter');
  assert.deepEqual(parsed.doc.firstChild.attrs.entries, [
    { key: 'name', value: 'html-offline-bundler' },
    { key: 'description', value: 'Makes CDN prototypes work offline' },
    { key: 'tags', value: '[ html, offline ]' },
  ]);
  assert.equal(parsed.ranges[0].from, 0);
  assert.equal(parsed.ranges[0].to, parsed.doc.firstChild.attrs.raw.length);
});

test('editing document content preserves front matter bytes exactly', () => {
  const header = '---\r\nname: skill\r\ndescription: "Keep: quotes and spacing"\r\n---\r\n\r\n';
  const source = header + '# Guide\r\n\r\nOriginal';
  const parsed = parseDocument(source);
  const paragraphPosition = parsed.ranges.at(-1).position;
  const replacement = schema.nodes.paragraph.create(null, schema.text('Changed'));
  const next = EditorState.create({ doc: parsed.doc }).tr.replaceWith(paragraphPosition, parsed.ranges.at(-1).end, replacement).doc;
  const change = richChange(source, parsed.doc, next, parsed.ranges);
  assert.ok(change);
  assert.ok(replaceText(source, change).startsWith(header));
});

test('malformed or non-leading YAML fences remain ordinary Markdown', () => {
  const malformed = parseDocument('---\nname: [broken\n---\n\nBody');
  assert.ok(!malformed.doc.content.content.some(node => node.type.name === 'front_matter'));
  const later = parseDocument('# Heading\n\n---\nname: later\n---\n');
  assert.ok(!later.doc.content.content.some(node => node.type.name === 'front_matter'));
  const fenced = parseDocument('```yaml\n---\nname: example\n---\n```');
  assert.ok(!fenced.doc.content.content.some(node => node.type.name === 'front_matter'));
});

test('adaptive table widths give prose room while keeping short fields compact', () => {
  const table = parseDocument('| ID | Type | Description |\n| --- | --- | --- |\n| 1 | date | This is a much longer explanation with many words that should receive more width. |\n| 2 | time | Another lengthy explanation about the business process and its validation rules. |').doc.firstChild;
  const widths = tableColumnWidths(table, 720, 14);
  assert.ok(widths[2] > widths[1] * 1.5);
  assert.ok(widths[1] > widths[0]);
  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - 720) < 3);
  assert.ok(tableColumnWidths(table, 120, 14).every(width => width >= 58));
});

test('adaptive columns support merged cells and preserve explicit widths', () => {
  const table = parseDocument('<table><tr><th colspan="2">Group</th><th>Notes</th></tr><tr><td>A</td><td>B</td><td>Long explanatory text for the notes column.</td></tr></table>').doc.firstChild;
  const widths = tableColumnWidths(table, 640);
  assert.equal(widths.length, 3);
  const cell = schema.nodes.table_cell.create({ colwidth: [112] }, schema.nodes.paragraph.create(null, schema.text('Fixed')));
  const manual = schema.nodes.table.create(null, schema.nodes.table_row.create(null, [cell, schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, schema.text('Flexible contents')))]));
  assert.equal(tableColumnWidths(manual, 600)[0], 112);
});

test('adaptive widths favor sustained row content over one long default value', () => {
  const description = '生产订单字段说明包含业务含义校验条件和后续处理规则';
  const rows = Array.from({ length: 24 }, (_, index) => `| ${index + 1} | ${description} | ${index === 0 ? description.repeat(24) : '-'} |`);
  const header = '| 序号 | 说明 | 默认值 |\n|---|---|---|\n';
  const widths = tableColumnWidths(parseDocument(header + rows.join('\n')).doc.firstChild, 720);
  assert.ok(widths[1] > widths[2] * 2.5, JSON.stringify(widths));
  const repeated = tableColumnWidths(parseDocument(header + [...rows, ...rows].join('\n')).doc.firstChild, 720);
  assert.ok(widths.every((width, index) => Math.abs(width - repeated[index]) <= 2));
  const shortDefaults = tableColumnWidths(parseDocument(header + rows.map((row, index) => `| ${index + 1} | ${description} | - |`).join('\n')).doc.firstChild, 720);
  assert.ok(widths[2] - shortDefaults[2] <= 20);
});

test('adaptive widths reward columns with long content on most rows', () => {
  const description = '字段保存当前业务过程的完整说明并参与后续校验处理';
  const rows = Array.from({ length: 20 }, (_, index) => `| ${index + 1} | ${index < 16 ? description : '-'} | ${index < 2 ? description : '-'} |`);
  const table = parseDocument('| ID | Frequent | Occasional |\n|---|---|---|\n' + rows.join('\n')).doc.firstChild;
  const widths = tableColumnWidths(table, 720);
  assert.ok(widths[1] > widths[2] * 1.7, JSON.stringify(widths));
  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - 720) < 3);
});

test('Mermaid compatibility quotes only unsafe plain flowchart labels', () => {
  const source = 'flowchart TD\n G --> H[GenerateNumber order(+reservation)]\n H --> I{Continue (yes)?}\n';
  assert.equal(quoteFlowchartLabels(source), 'flowchart TD\n G --> H["GenerateNumber order(+reservation)"]\n H --> I{"Continue (yes)?"}\n');
  assert.equal(quoteFlowchartLabels('flowchart LR\n A[Safe] --> B[Done]'), 'flowchart LR\n A[Safe] --> B[Done]');
});

test('Mermaid compatibility leaves quoted labels and other shapes or diagram types unchanged', () => {
  for (const source of [
    'flowchart LR\n A["Text B[nested (label)]"] --> C["Done"]',
    'flowchart LR\n A[[Subroutine (label)]] --> B[/Input (value)/]',
    'flowchart LR\n A((Circle (text))) --> B[Done]',
    'flowchart LR\n A -->|Note B[edge (text)]| C[Done]',
    'sequenceDiagram\n A->>B: Data[Value (text)]',
    'flowchart LR\n %% A[Comment (text)]\n classDef style fill:red',
  ]) assert.equal(quoteFlowchartLabels(source), source);
});

test('tables, formulas and diagrams use real editor nodes', () => {
  const parsed = parseDocument('# Title\n\nText $x^2$ here.\n\n$$\ny=x+1\n$$\n\n| A | B |\n|---|---|\n| a | b |\n\n```mermaid\nflowchart LR\n A-->B\n```\n');
  assert.deepEqual(parsed.ranges.map(range => range.node.type.name), ['heading', 'paragraph', 'math_block', 'table', 'mermaid']);
  assert.equal(parsed.doc.child(1).child(1).type.name, 'math_inline');
  assert.equal(parsed.doc.child(3).child(1).child(0).firstChild.textContent, 'a');
  parsed.doc.check();
});

test('right-side edit preserves unrelated original Markdown formatting', () => {
  const source = '# Original\n\n_Keep this_  \n\nChange me\n\n```js\nconst x=1;\n```\n';
  const parsed = parseDocument(source);
  const state = EditorState.create({ doc: parsed.doc });
  const position = parsed.ranges[2].position + 1;
  const transaction = state.tr.insertText('Edited ', position);
  const change = richChange(source, parsed.doc, transaction.doc, parsed.ranges);
  assert.equal(replaceText(source, change), source.replace('Change me', 'Edited Change me'));
});

test('simple rich typing retains original inline delimiters', () => {
  const source = 'One _italic_ and **bold**.\n';
  const parsed = parseDocument(source);
  const position = prosePosition(parsed, source.indexOf('italic') + 2);
  const state = EditorState.create({ doc: parsed.doc });
  const transaction = state.tr.insertText('NEW', position);
  const change = plainTextChange(parsed, transaction);
  assert.ok(change);
  assert.equal(replaceText(source, change), 'One _itNEWalic_ and **bold**.\n');
});

test('table serialization survives a parse cycle', () => {
  const source = '| A | B |\n|---|---|\n| **hello** | a\\|b |\n';
  const parsed = parseDocument(source);
  assert.ok(parseDocument(serializer.serialize(parsed.doc)).doc.eq(parsed.doc));
});

test('position mapping follows text in headings, lists and table cells', () => {
  const source = '# Heading\n\n- first\n- second\n\n| A | B |\n|---|---|\n| red | blue |\n';
  const parsed = parseDocument(source);
  for (const word of ['Heading', 'first', 'second', 'red', 'blue']) {
    const offset = source.indexOf(word) + 1;
    assert.equal(sourcePosition(parsed, prosePosition(parsed, offset)), offset);
  }
});

test('empty documents remain editable and structural changes can replace all content', () => {
  const parsed = parseDocument('');
  parsed.doc.check();
  const next = schema.node('doc', null, [schema.node('paragraph', null, schema.text('Hello'))]);
  assert.equal(replaceText('', richChange('', parsed.doc, next, parsed.ranges)), 'Hello');
});

test('TOC and page-break markers become dedicated nodes without changing their source', () => {
  const source = '[toc]\n\n<!-- pagebreak -->\n\n# First\n\n## Child\n\n# First\n';
  const parsed = parseDocument(source);
  assert.deepEqual(parsed.ranges.map(range => range.node.type.name), ['toc', 'page_break', 'heading', 'heading', 'heading']);
  const headings = documentHeadings(parsed.doc);
  assert.deepEqual(headings.map(heading => heading.level), [1, 2, 1]);
  assert.equal(new Set(headings.map(heading => heading.id)).size, 3);
  const output = serializer.serialize(parsed.doc);
  assert.ok(output.startsWith('[toc]'));
  assert.ok(output.includes('<!-- pagebreak -->'));
  assert.ok(parseDocument(output).doc.eq(parsed.doc));
  assert.deepEqual(wordStatistics(parsed.doc), { han: 0, letters: 15, numbers: 0, total: 15 });
});

test('TOC markers inside code or normal links remain literal content', () => {
  const source = '```md\n[TOC]\n<!-- pagebreak -->\n```\n\nText [toc] here.\n\n[TOC](https://example.com)\n\n    [TOC]\n';
  const parsed = parseDocument(source);
  assert.ok(parsed.ranges.every(range => !['toc', 'page_break'].includes(range.node.type.name)));
});

test('raw HTML is displayed as text rather than executed', () => {
  const parsed = parseDocument('<script>alert(1)</script>');
  assert.equal(parsed.doc.textContent, '<script>alert(1)</script>');
});

test('merged HTML tables preserve their real cells and survive serialization', () => {
  const source = '| A | B |\n| --- | --- |\n| one | two |\n\n<table>\n<thead><tr><th colspan="2">Group</th></tr></thead>\n<tbody><tr><td>first</td><td>second</td></tr></tbody>\n</table>\n';
  const parsed = parseDocument(source);
  assert.equal(parsed.ranges.filter(range => range.node.type.name === 'table').length, 2);
  assert.equal(parsed.doc.child(1).firstChild.firstChild.attrs.colspan, 2);
  assert.equal(parsed.doc.child(1).attrs.format, 'html');
  assert.ok(!parsed.doc.textContent.includes('<th'));
  assert.ok(parseDocument(serializer.serialize(parsed.doc)).doc.eq(parsed.doc));
});

test('HTML table row spans and inline text are safe to edit and save', () => {
  const source = '# Keep\n\n<table><tr><th rowspan="2">Group</th><td><strong>A &amp; B</strong><br><code>x</code></td></tr><tr><td>second</td></tr></table>\n\n_Unchanged_\n';
  const parsed = parseDocument(source);
  assert.equal(parsed.doc.child(1).firstChild.firstChild.attrs.rowspan, 2);
  const state = EditorState.create({ doc: parsed.doc });
  const position = prosePosition(parsed, source.indexOf('second'));
  const transaction = state.tr.insertText('new ', position);
  assert.equal(plainTextChange(parsed, transaction), null);
  const updated = replaceText(source, richChange(source, parsed.doc, transaction.doc, parsed.ranges));
  assert.ok(updated.includes('rowspan="2"'));
  assert.ok(updated.endsWith('_Unchanged_\n'));
  assert.ok(updated.startsWith('# Keep\n\n'));
  assert.ok(parseDocument(updated).doc.eq(transaction.doc));
});

test('HTML tables cannot introduce scripts handlers styles or unsafe links', () => {
  const source = '<table onclick="attack()"><tr><td style="background:url(https://bad)"><script>attack()</script><iframe src="https://bad"></iframe><a href="javascript:attack()">Safe text</a><img src="https://bad/image" onerror="attack()"></td></tr></table>';
  const parsed = parseDocument(source);
  assert.equal(parsed.doc.firstChild.type.name, 'table');
  assert.equal(parsed.doc.textContent, 'Safe text');
  const output = serializer.serialize(parsed.doc);
  assert.ok(!/attack|javascript:|onclick|onerror|iframe|script|style=|https:\/\/bad/.test(output));
});

test('HTML text alignment inherits through tables and preserves paragraph overrides', () => {
  const source = '<table style="text-align:center;background:url(https://bad)"><tr><td><h2 align="center">Brand</h2><p>Company</p><p style="text-align:right">Rights</p></td><td align="left"><p>Local</p></td></tr></table>';
  const parsed = parseDocument(source);
  const row = parsed.doc.firstChild.firstChild;
  assert.equal(row.child(0).attrs.textAlign, 'center');
  assert.equal(row.child(1).attrs.textAlign, 'left');
  assert.equal(row.child(0).child(0).attrs.textAlign, 'center');
  assert.equal(row.child(0).child(2).attrs.textAlign, 'right');
  const serialized = serializer.serialize(parsed.doc);
  assert.ok(!serialized.includes('https://bad'));
  assert.ok(parseDocument(serialized).doc.eq(parsed.doc));
});

test('incomplete and nested tables retain source text without swallowing later blocks', () => {
  const source = '<table>\n<tr><td>incomplete\n\n## Later heading\n\n<table><tr><td>valid</td></tr></table>\n';
  const parsed = parseDocument(source);
  assert.ok(parsed.ranges.some(range => range.node.type.name === 'heading'));
  assert.equal(parsed.ranges.filter(range => range.node.type.name === 'table').length, 1);
  const nested = parseDocument('<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>');
  assert.ok(nested.doc.textContent.includes('<table>'));
  const oversized = parseDocument('<table><tr><td colspan="256" rowspan="2">A</td></tr><tr><td colspan="256">B</td></tr></table>');
  assert.ok(oversized.doc.textContent.includes('<table>'));
});

test('word statistics count Han letters and numbers without Markdown syntax or link targets', () => {
  const source = '# \u4e2d\u6587 ABC 123\n\n[\u94fe\u63a5](https://example.com/path) **de** ![hidden](image123.png)\n\n| A | B |\n| --- | --- |\n| \u6c49 | 2 |\n\n```js\nx=4;\n```';
  assert.deepEqual(wordStatistics(parseDocument(source).doc), { han: 5, letters: 8, numbers: 5, total: 18 });
});

test('word statistics use Unicode code points and ignore punctuation and whitespace', () => {
  assert.deepEqual(wordStatistics(parseDocument('\u{20000}\u6c49 \u00e9\u{10400} \u0661\uff12 \ud83d\ude00 !?\n\n').doc), { han: 2, letters: 2, numbers: 2, total: 6 });
  assert.equal(wordStatistics(parseDocument('').doc).total, 0);
});

test('image insertion at the end of bold text never leaves visible Markdown delimiters', () => {
  const source = 'Intro **remember this**\n\n_Keep the next paragraph_\n';
  const offset = source.indexOf('this') + 4;
  const inserted = imageInsertion(source, offset, offset, { src: '.inklet-assets/image.png', alt: 'picture' });
  const updated = replaceText(source, inserted.change);
  const parsed = parseDocument(updated);
  assert.ok(!parsed.doc.textContent.includes('**'));
  assert.ok(updated.endsWith('_Keep the next paragraph_\n'));
  let images = 0;
  let bold = '';
  parsed.doc.descendants(node => {
    if (node.type.name === 'image') { images++; assert.equal(node.marks.length, 0); }
    if (node.isText && node.marks.some(mark => mark.type.name === 'strong')) bold += node.text;
  });
  assert.equal(images, 1);
  assert.equal(bold, 'remember this');
});

test('image insertion splits formatted text into balanced paragraphs', () => {
  for (const source of ['**before after**\n', '*before after*\n', '[before after](https://example.com)\n']) {
    const offset = source.indexOf('after');
    const inserted = imageInsertion(source, offset, offset, { src: 'image.png', alt: 'image [1]' });
    const parsed = parseDocument(replaceText(source, inserted.change));
    parsed.doc.check();
    assert.deepEqual(parsed.ranges.filter(range => range.node.textContent).map(range => range.node.textContent.trimEnd()), ['before', 'after']);
    assert.ok(parsed.ranges.some(range => range.node.childCount === 1 && range.node.firstChild.type.name === 'image'));
  }
});

test('successive image insertion preserves order and one-step undo source', () => {
  const initial = '**text**\n';
  const first = imageInsertion(initial, 6, 6, { src: 'first.png' });
  const afterFirst = replaceText(initial, first.change);
  const second = imageInsertion(afterFirst, first.cursor, first.cursor, { src: 'second.png' });
  const afterSecond = replaceText(afterFirst, second.change);
  const images = [];
  parseDocument(afterSecond).doc.descendants(node => { if (node.type.name === 'image') images.push(node.attrs.src); });
  assert.deepEqual(images, ['first.png', 'second.png']);
  const document = new DocumentSession(initial);
  document.replace(first.change);
  document.replace(second.change);
  document.undo();
  assert.equal(document.source, afterFirst);
  document.undo();
  assert.equal(document.source, initial);
});

test('inserting an image before a formula keeps the following block separate', () => {
  const source = 'Original **paragraph.**\n\n$$\nE=mc^2\n$$\n';
  const offset = source.indexOf('paragraph.') + 'paragraph.'.length;
  const result = imageInsertion(source, offset, offset, { src: 'image.png' });
  const parsed = parseDocument(replaceText(source, result.change));
  assert.deepEqual(parsed.ranges.map(range => range.node.type.name), ['paragraph', 'paragraph', 'math_block']);
});