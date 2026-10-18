import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import xml from 'xml-js';
import { parseDocument } from '../src/markdown.js';
import { createWord } from '../src/export-document.js';

function elements(node, name) {
  return [...(node.name === name ? [node] : []), ...(node.elements || []).flatMap(child => elements(child, name))];
}

test('Word export creates editable headings, tables, code colors and a genuine DOCX package', async () => {
  const source = '# Heading\n\nText **bold** and _italic_.\n\n| A | B |\n|---|---|\n| one | two |\n\n```python\ndef hello():\n    return 1\n```\n';
  const encoded = await createWord({ title: 'Document', doc: parseDocument(source).doc, images: new Map(), graphics: new Map(), colors: { python: { keyword: '#112233' } } });
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const archive = await JSZip.loadAsync(bytes);
  assert.ok(archive.file('[Content_Types].xml'));
  const content = xml.xml2js(await archive.file('word/document.xml').async('string'));
  assert.ok(elements(content, 'w:pStyle').some(node => node.attributes['w:val'] === 'Heading1'));
  assert.equal(elements(content, 'w:tbl').length, 1);
  assert.ok(elements(content, 'w:b').length > 0);
  assert.ok(elements(content, 'w:i').length > 0);
  assert.ok(elements(content, 'w:color').some(node => node.attributes['w:val'] === '112233'));
  assert.ok(elements(content, 'w:t').some(node => (node.elements || []).some(child => child.text === 'hello')));
});

test('Word export preserves HTML row and column spans', async () => {
  const source = '<table><tr><th colspan="2">Group</th></tr><tr><td rowspan="2">Shared</td><td>A</td></tr><tr><td>B</td></tr></table>';
  const encoded = await createWord({ title: 'Merged', doc: parseDocument(source).doc, images: new Map(), graphics: new Map(), colors: {} });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  const content = xml.xml2js(await archive.file('word/document.xml').async('string'));
  assert.ok(elements(content, 'w:gridSpan').some(node => node.attributes['w:val'] === '2'));
  assert.ok(elements(content, 'w:vMerge').some(node => node.attributes?.['w:val'] === 'restart'));
  assert.ok(elements(content, 'w:vMerge').length >= 2);
  assert.equal(elements(content, 'w:tblHeader').filter(node => !['0', 'false', 'off'].includes(node.attributes?.['w:val'])).length, 1);
});

test('Word export retains HTML cell alignment and paragraph overrides', async () => {
  const source = '<table style="text-align:center"><tr><td><p>Centered</p><p align="right">Right</p></td><td align="left">Left</td></tr></table>';
  const encoded = await createWord({ title: 'Alignment', doc: parseDocument(source).doc, images: new Map(), graphics: new Map(), colors: {} });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  const content = xml.xml2js(await archive.file('word/document.xml').async('string'));
  assert.deepEqual(elements(content, 'w:jc').slice(0, 3).map(node => node.attributes['w:val']), ['center', 'right', 'left']);
});

test('Word export uses supplied reading typography for body and all heading levels', async () => {
  const typography = {
    body: { font: 'Manrope', eastAsia: 'Microsoft YaHei', fontSize: 20, lineHeight: 2.1, marginTop: 14, marginBottom: 22, color: '334455' },
    headings: { 3: { fontSize: 24, lineHeight: 1.6, marginTop: 30, marginBottom: 16 }, 4: { fontSize: 21, lineHeight: 1.5, marginTop: 26, marginBottom: 12 } },
  };
  const encoded = await createWord({ title: 'Typography', doc: parseDocument('### Third\n\n#### Fourth\n\nBody paragraph.').doc, images: new Map(), graphics: new Map(), colors: {}, typography });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  const styles = xml.xml2js(await archive.file('word/styles.xml').async('string'));
  const defaults = elements(styles, 'w:docDefaults')[0];
  assert.equal(elements(defaults, 'w:rFonts')[0].attributes['w:ascii'], 'Manrope');
  assert.equal(elements(defaults, 'w:rFonts')[0].attributes['w:eastAsia'], 'Microsoft YaHei');
  assert.equal(elements(defaults, 'w:sz')[0].attributes['w:val'], '30');
  assert.deepEqual(elements(defaults, 'w:spacing')[0].attributes, { 'w:before': '210', 'w:after': '330', 'w:line': '504', 'w:lineRule': 'auto' });
  const third = elements(styles, 'w:style').find(style => style.attributes['w:styleId'] === 'Heading3');
  const fourth = elements(styles, 'w:style').find(style => style.attributes['w:styleId'] === 'Heading4');
  assert.equal(elements(third, 'w:sz')[0].attributes['w:val'], '36');
  assert.equal(elements(fourth, 'w:sz')[0].attributes['w:val'], '32');
  assert.equal(elements(fourth, 'w:outlineLvl')[0].attributes['w:val'], '3');
  assert.equal(elements(third, 'w:spacing')[0].attributes['w:after'], '240');
});

test('Word tables use content-weighted columns and compact cell paragraphs', async () => {
  const source = '| ID | Type | Description |\n| --- | --- | --- |\n| 1 | date | A long business explanation should receive more space than a short identifier. |';
  const encoded = await createWord({ title: 'Columns', doc: parseDocument(source).doc, images: new Map(), graphics: new Map(), colors: {} });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  const content = xml.xml2js(await archive.file('word/document.xml').async('string'));
  const widths = elements(content, 'w:gridCol').map(node => Number(node.attributes['w:w']));
  assert.ok(widths[2] > widths[0] * 1.5);
  assert.ok(elements(content, 'w:pStyle').some(node => node.attributes['w:val'] === 'InkletTable'));
});

test('Word export creates linked contents bookmarks and real page breaks', async () => {
  const source = '[toc]\n\n<!-- pagebreak -->\n\n# Same\n\n## Child\n\n# Same\n';
  const encoded = await createWord({ title: 'Contents', doc: parseDocument(source).doc, images: new Map(), graphics: new Map(), colors: {} });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  const content = xml.xml2js(await archive.file('word/document.xml').async('string'));
  const anchors = elements(content, 'w:hyperlink').map(node => node.attributes['w:anchor']);
  const bookmarks = elements(content, 'w:bookmarkStart').map(node => node.attributes['w:name']);
  assert.equal(anchors.length, 3);
  assert.equal(new Set(anchors).size, 3);
  assert.ok(anchors.every(anchor => bookmarks.includes(anchor)));
  assert.ok(elements(content, 'w:br').some(node => node.attributes?.['w:type'] === 'page'));
  assert.ok(!elements(content, 'w:t').some(node => (node.elements || []).some(child => /\[toc\]|pagebreak/i.test(child.text || ''))));
});

test('Word export embeds image bytes rather than linking to local paths', async () => {
  const asset = { data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', width: 1, height: 1 };
  const encoded = await createWord({ title: 'Image document', doc: parseDocument('![image](local.png)').doc, images: new Map([['local.png', asset]]), graphics: new Map(), colors: {} });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  assert.ok(Object.keys(archive.files).some(name => name.startsWith('word/media/') && name.endsWith('.png')));
  const relations = xml.xml2js(await archive.file('word/_rels/document.xml.rels').async('string'));
  assert.ok(elements(relations, 'Relationship').some(node => node.attributes.Type.endsWith('/image') && !node.attributes.TargetMode));
});

test('Word image dimensions fit the page and merged table cells without stretching', async () => {
  const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const images = new Map([['wide.png', { data, width: 1800, height: 900 }], ['tall.png', { data, width: 900, height: 4500 }]]);
  const source = '![Wide](wide.png)\n\n![Tall](tall.png)\n\n<table><tr><td rowspan="2">ID</td><td colspan="2"><img src="wide.png" alt="Merged"></td></tr><tr><td><img src="wide.png" alt="Small"></td><td>Notes</td></tr></table>';
  const encoded = await createWord({ title: 'Image sizing', doc: parseDocument(source).doc, images, graphics: new Map(), colors: {} });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  const content = xml.xml2js(await archive.file('word/document.xml').async('string'));
  const sizes = elements(content, 'wp:extent').map(node => ({ width: Number(node.attributes.cx) / 9525, height: Number(node.attributes.cy) / 9525 }));
  assert.equal(sizes.length, 4);
  assert.ok(sizes.every(size => size.width <= 659 && size.height <= 780));
  assert.ok(Math.abs(sizes[0].width / sizes[0].height - 2) < .02);
  assert.ok(Math.abs(sizes[1].width / sizes[1].height - .2) < .01);
  const columns = elements(content, 'w:gridCol').map(node => Number(node.attributes['w:w']));
  assert.ok(sizes[2].width <= Math.ceil((columns[1] + columns[2] - 240) / 15));
  assert.ok(sizes[3].width <= Math.ceil((columns[1] - 240) / 15));
  assert.ok(sizes[2].width > sizes[3].width);
});

test('Word export renders YAML front matter as an editable property table', async () => {
  const source = '---\nname: sample-skill\ndescription: "A complete skill description"\n---\n\n# Guide\n';
  const encoded = await createWord({ title: 'Skill', doc: parseDocument(source).doc, images: new Map(), graphics: new Map(), colors: {} });
  const archive = await JSZip.loadAsync(Buffer.from(encoded, 'base64'));
  const content = xml.xml2js(await archive.file('word/document.xml').async('string'));
  assert.equal(elements(content, 'w:tbl').length, 1);
  const text = elements(content, 'w:t').flatMap(node => node.elements || []).map(child => child.text).filter(Boolean);
  assert.ok(['name', 'sample-skill', 'description', 'A complete skill description'].every(value => text.includes(value)));
  assert.ok(!text.includes('---'));
});