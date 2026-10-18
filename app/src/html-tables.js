import { parseFragment } from 'parse5';
import { TableMap } from 'prosemirror-tables';

const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'input', 'button', 'select', 'textarea']);
const blockTags = new Set(['p', 'div', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const markTags = { b: 'strong', strong: 'strong', i: 'em', em: 'em', s: 'strike', del: 'strike', strike: 'strike', code: 'code' };
const attribute = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function textAlignment(value) {
  const alignment = String(value || '').trim().toLowerCase();
  return ['left', 'center', 'right', 'justify', 'start', 'end'].includes(alignment) ? alignment : null;
}

function htmlAlignment(node, fallback = null) {
  let alignment = textAlignment(attribute(node, 'align')) || fallback;
  for (const match of (attribute(node, 'style') || '').matchAll(/(?:^|;)\s*text-align\s*:\s*(left|center|right|justify|start|end)\s*(?:!important\s*)?(?=;|$)/gi)) alignment = match[1].toLowerCase();
  return alignment;
}

function safeLink(value) {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  if (/^(?:https?:|mailto:)/i.test(value) || (!/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('//'))) return value;
  return null;
}

function cellContent(cell, schema) {
  const paragraphs = [];
  let inline = [];
  let paragraphAlignment = null;
  const flush = () => {
    while (inline[0]?.isText && !inline[0].text.trim()) inline.shift();
    while (inline.at(-1)?.isText && !inline.at(-1).text.trim()) inline.pop();
    if (inline.length) paragraphs.push(schema.nodes.paragraph.create({ textAlign: paragraphAlignment }, inline));
    inline = [];
    paragraphAlignment = null;
  };
  const visit = (node, marks = [], inheritedAlignment = null) => {
    if (node.nodeName === '#text') {
      const text = node.value.replace(/[\t\r\n\f ]+/g, ' ');
      if (text) inline.push(schema.text(text, marks));
      return;
    }
    const tag = node.tagName;
    if (!tag || blocked.has(tag)) return;
    if (tag === 'table') throw new Error('Nested HTML tables are not supported');
    if (tag === 'br') { inline.push(schema.nodes.hard_break.create()); return; }
    if (tag === 'img') {
      const source = attribute(node, 'src');
      if (source && (!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source) || /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(source) || /^file:\/\/\//i.test(source) || /^[a-z]:[\\/]/i.test(source))) inline.push(schema.nodes.image.create({ src: source, alt: attribute(node, 'alt') || '', title: attribute(node, 'title') || null }));
      return;
    }
    const alignment = htmlAlignment(node, inheritedAlignment);
    if (blockTags.has(tag)) { flush(); paragraphAlignment = alignment; }
    let nextMarks = marks;
    if (markTags[tag]) nextMarks = schema.marks[markTags[tag]].create().addToSet(marks);
    if (tag === 'a') {
      const href = safeLink(attribute(node, 'href'));
      if (href) nextMarks = schema.marks.link.create({ href, title: attribute(node, 'title') || null }).addToSet(marks);
    }
    for (const child of node.childNodes || []) visit(child, nextMarks, alignment);
    if (blockTags.has(tag)) flush();
  };
  for (const child of cell.childNodes || []) visit(child);
  flush();
  return paragraphs.length ? paragraphs : [schema.nodes.paragraph.create()];
}

export function parseHtmlTable(source, schema) {
  const fragment = parseFragment(source, { sourceCodeLocationInfo: true });
  const meaningful = fragment.childNodes.filter(node => node.nodeName !== '#comment' && (node.nodeName !== '#text' || node.value.trim()));
  if (meaningful.length !== 1 || meaningful[0].tagName !== 'table') return null;
  const table = meaningful[0];
  if (!table.sourceCodeLocation?.endTag) return null;
  const rows = [];
  for (const child of table.childNodes) {
    if (child.tagName === 'tr') rows.push(child);
    else if (['thead', 'tbody', 'tfoot'].includes(child.tagName)) rows.push(...child.childNodes.filter(node => node.tagName === 'tr'));
    else if (child.tagName === 'caption' && child.childNodes.some(node => node.value?.trim() || node.tagName)) return null;
  }
  if (!rows.length || rows.length > 10000) return null;
  const remainingRows = new Map();
  const rowsLeft = rows.map(() => 0);
  for (let index = rows.length - 1; index >= 0; index--) {
    const group = rows[index].parentNode;
    const remaining = (remainingRows.get(group) || 0) + 1;
    remainingRows.set(group, remaining);
    rowsLeft[index] = remaining;
  }
  try {
    const result = schema.nodes.table.create({ format: 'html' }, rows.map((row, index) => {
      const inheritedAlignment = htmlAlignment(row, htmlAlignment(row.parentNode, htmlAlignment(table)));
      const cells = row.childNodes.filter(node => node.tagName === 'td' || node.tagName === 'th').map(cell => {
        const colspan = Math.max(1, Math.min(256, parseInt(attribute(cell, 'colspan'), 10) || 1));
        const requestedRows = attribute(cell, 'rowspan');
        const remaining = rowsLeft[index];
        const rowspan = requestedRows === '0' ? remaining : Math.max(1, Math.min(remaining, parseInt(requestedRows, 10) || 1));
        return schema.nodes[cell.tagName === 'th' ? 'table_header' : 'table_cell'].create({ colspan, rowspan, textAlign: htmlAlignment(cell, inheritedAlignment) }, cellContent(cell, schema));
      });
      return schema.nodes.table_row.create(null, cells);
    }));
    const occupiedUntil = new Array(256).fill(0);
    let rowIndex = 0;
    let bounded = true;
    result.forEach(row => {
      let column = 0;
      row.forEach(cell => {
        while (occupiedUntil[column] > rowIndex) column++;
        if (column + cell.attrs.colspan > 256) { bounded = false; return; }
        for (let offset = 0; offset < cell.attrs.colspan; offset++) {
          if (occupiedUntil[column + offset] > rowIndex) bounded = false;
          occupiedUntil[column + offset] = rowIndex + cell.attrs.rowspan;
        }
        column += cell.attrs.colspan;
      });
      rowIndex++;
    });
    if (!bounded) return null;
    if (TableMap.get(result).problems?.length) return null;
    result.check();
    return result;
  } catch { return null; }
}

export function htmlTableSource(table) {
  const render = node => {
    if (node.isText) {
      let text = escapeHtml(node.text);
      for (const mark of node.marks) {
        if (mark.type.name === 'link') {
          const href = safeLink(mark.attrs.href);
          if (href) text = '<a href="' + escapeHtml(href) + '"' + (mark.attrs.title ? ' title="' + escapeHtml(mark.attrs.title) + '"' : '') + '>' + text + '</a>';
        } else {
          const tag = { strong: 'strong', em: 'em', strike: 's', code: 'code' }[mark.type.name];
          if (tag) text = '<' + tag + '>' + text + '</' + tag + '>';
        }
      }
      return text;
    }
    if (node.type.name === 'hard_break') return '<br>';
    if (node.type.name === 'image') return '<img src="' + escapeHtml(node.attrs.src) + '" alt="' + escapeHtml(node.attrs.alt || '') + '">';
    if (node.type.name === 'math_inline') return escapeHtml('$' + node.attrs.tex + '$');
    let content = '';
    node.forEach(child => { content += render(child); });
    const alignment = textAlignment(node.attrs.textAlign);
    return node.type.name === 'paragraph' ? '<p' + (alignment ? ' style="text-align:' + alignment + '"' : '') + '>' + content + '</p>' : content;
  };
  const rows = [];
  table.forEach(row => {
    const cells = [];
    row.forEach(cell => {
      const tag = cell.type.name === 'table_header' ? 'th' : 'td';
      const alignment = textAlignment(cell.attrs.textAlign);
      const attrs = (cell.attrs.colspan > 1 ? ' colspan="' + cell.attrs.colspan + '"' : '') + (cell.attrs.rowspan > 1 ? ' rowspan="' + cell.attrs.rowspan + '"' : '') + (alignment ? ' style="text-align:' + alignment + '"' : '');
      cells.push('<' + tag + attrs + '>' + render(cell) + '</' + tag + '>');
    });
    rows.push('<tr>' + cells.join('') + '</tr>');
  });
  return '<table>\n<tbody>\n' + rows.join('\n') + '\n</tbody>\n</table>';
}