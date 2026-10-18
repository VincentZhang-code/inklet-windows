import { DOMSerializer } from 'prosemirror-model';
import { TableMap } from 'prosemirror-tables';
import DOMPurify from 'dompurify';
import { parseDocument, schema, documentHeadings } from './markdown.js';
import { textAlignment } from './html-tables.js';
import { renderTableOfContents } from './document-toc.js';
import { tableColumnWidths } from './table-layout.js';
import { renderMarkup } from './renderers.js';
import { codeSpans, codePalette, colorForClass, prepareCodeHighlighting } from './code-highlighting.js';

const exportCss = `@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;color:#26332b;background:white;font-family:"Noto Serif SC","SimSun",serif;font-size:17px;line-height:1.9}main{max-width:800px;margin:0 auto;padding:30px}h1,h2,h3,h4{line-height:1.5;page-break-after:avoid}h1{font-size:28px}h2{font-size:23px;margin-top:1.6em}h3{font-size:20px}p{margin:1em 0;overflow-wrap:anywhere}strong{font-weight:700}a{color:#286b91}blockquote{margin:1.3em 0;border-left:3px solid #9aaf9d;padding-left:18px;color:#566f5b}table{border-collapse:collapse;width:100%;font-size:14px;line-height:1.6;margin:20px 0}td,th{border:1px solid #bdcebf;padding:8px 10px;vertical-align:top}th{background:#eef3ed}td p,th p{margin:0}.front-matter-properties{table-layout:fixed;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;break-inside:avoid}.front-matter-properties th{width:28%;text-align:left}.front-matter-properties td{white-space:pre-wrap;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:Consolas,monospace;font-size:13px;line-height:1.65;background:#f3f6f2;border:1px solid #d6dfd3;padding:16px;border-radius:4px;break-inside:avoid}code{font-family:Consolas,monospace}img{max-width:100%;height:auto}svg{max-width:100%;height:auto}.math-block,.diagram-block{text-align:center;margin:20px 0;break-inside:avoid}.math-inline{display:inline-block;vertical-align:middle}.math-inline img{vertical-align:middle;max-height:2.8em}.export-graphic{display:block;margin:0 auto}li p{margin:.2em 0}@media print{main{max-width:none;padding:0}body{font-size:11pt}pre{font-size:9pt}thead{display:table-header-group}a{color:inherit}}`;
const graphicKey = (kind, value) => kind + '\0' + value;
const navigationCss = '.document-toc-list{list-style:none;padding:0;margin:16px 0}.document-toc-list li{margin-block:5px}.document-toc-list a{text-decoration:none;overflow-wrap:anywhere}.document-pagebreak{break-after:page;page-break-after:always;height:0;margin:0;border:0}';
const noteCss = 'blockquote{padding:14px 18px;border:1px solid #d3e0e6;border-left:3px solid #819eae;border-radius:6px;background:#edf4f6;color:#405766;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:.92em;line-height:1.85}blockquote>:first-child{margin-top:0}blockquote>:last-child{margin-bottom:0}blockquote strong{color:#29495b}blockquote blockquote{background:transparent;font-size:inherit;border-top:0;border-right:0;border-bottom:0;border-radius:0}';
const bytesFromBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const fontAvailability = new Map();

function readableImagePath(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function missingImageText(path, alt) {
  return '[图片未导出：' + (alt ? alt + '（' + readableImagePath(path) + '）' : readableImagePath(path)) + ']';
}

async function availableFont(families, fallback) {
  for (const family of families) {
    if ([...document.fonts].some(face => face.status === 'loaded' && face.family.replace(/["']/g, '') === family)) return family;
    if (!fontAvailability.has(family)) fontAvailability.set(family, new FontFace('InkletFontProbe', 'local("' + family.replace(/["\\]/g, '') + '")').load().then(() => true, () => false));
    if (await fontAvailability.get(family)) return family;
  }
  return fallback;
}

export async function captureReadingTypography(editor) {
  await document.fonts.ready;
  const sample = document.createElement('section');
  sample.className = 'rich-pane'; sample.setAttribute('aria-hidden', 'true'); sample.inert = true;
  sample.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;visibility:hidden;pointer-events:none';
  const prose = document.createElement('div'); prose.className = 'ProseMirror';
  sample.append(prose); document.body.append(sample);
  const readStyle = async element => {
    const style = getComputedStyle(element);
    const families = style.fontFamily.split(',').map(family => family.trim().replace(/^["']|["']$/g, '')).filter(family => !['serif', 'sans-serif', 'monospace', 'system-ui'].includes(family));
    const asian = families.filter(family => !/^(Literata|Manrope|Consolas|Cascadia Code)$/i.test(family));
    const fontSize = parseFloat(style.fontSize);
    const channels = style.color.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [48, 56, 49];
    return { font: await availableFont(families, 'Calibri'), eastAsia: await availableFont(asian, 'SimSun'), fontSize, lineHeight: (parseFloat(style.lineHeight) || fontSize * 1.6) / fontSize, marginTop: parseFloat(style.marginTop) || 0, marginBottom: parseFloat(style.marginBottom) || 0, color: channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase(), bold: Number(style.fontWeight) >= 600 };
  };
  try {
    const parent = getComputedStyle(editor);
    prose.style.fontFamily = parent.fontFamily; prose.style.fontSize = parent.fontSize; prose.style.lineHeight = parent.lineHeight; prose.style.color = editor.closest('[data-paper-mode="dark"]') ? '#303831' : parent.color;
    const paragraph = document.createElement('p'); paragraph.textContent = 'Reading sample'; prose.append(paragraph);
    const body = await readStyle(paragraph);
    const headings = {};
    for (let level = 1; level <= 6; level++) {
      const heading = document.createElement('h' + level); heading.textContent = 'Heading'; prose.append(heading);
      headings[level] = await readStyle(heading);
    }
    const table = document.createElement('table'); table.innerHTML = '<tbody><tr><td><p>Cell</p></td></tr></tbody>'; prose.append(table);
    const quote = document.createElement('blockquote'); quote.innerHTML = '<p>Note</p>'; prose.append(quote);
    const pre = document.createElement('pre'); pre.textContent = 'code'; prose.append(pre);
    return { body, headings, table: await readStyle(table.querySelector('p')), quote: await readStyle(quote.querySelector('p')), code: await readStyle(pre) };
  } finally { sample.remove(); }
}

async function rasterAsset(dataUrl, maxWidth = 720, maxHeight = 920, pixelRatio = 2) {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const ratio = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  const scale = Math.min(pixelRatio, 2400 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  const png = canvas.toDataURL('image/png');
  return { dataUrl: png, data: png.split(',')[1], width, height };
}

export async function prepareEmbeddedAsset(asset) {
  const dataUrl = 'data:' + asset.mime + ';base64,' + asset.data;
  if (/^image\/(svg\+xml|bmp)$/i.test(asset.mime)) {
    const converted = await rasterAsset(dataUrl, 1920, Infinity, 1);
    return { mime: 'image/png', data: converted.data };
  }
  if (!/^image\/(png|jpeg|gif|webp)$/i.test(asset.mime)) throw new Error('不支持内嵌此图片格式。');
  const image = new Image(); image.src = dataUrl; await image.decode();
  return asset;
}

async function rasterSvg(markup, inline) {
  const container = document.createElement('div'); container.innerHTML = markup;
  const svg = container.querySelector('svg');
  if (!svg) throw new Error('公式或图表没有生成有效图像。');
  const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const dimension = (value, fallback) => value?.endsWith('ex') ? parseFloat(value) * 8 : value?.endsWith('em') ? parseFloat(value) * 16 : /^\d+(\.\d+)?$/.test(value || '') ? Number(value) : fallback;
  let width = dimension(svg.getAttribute('width'), viewBox[2] || 600);
  let height = dimension(svg.getAttribute('height'), viewBox[3] || 200);
  const ratio = Math.min(1, 720 / width, 920 / height, inline ? 42 / height : 1);
  width = Math.max(1, width * ratio); height = Math.max(1, height * ratio);
  svg.setAttribute('width', String(width * 2)); svg.setAttribute('height', String(height * 2));
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.style.color = '#26332b';
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const result = await rasterAsset(url, width, height);
    return { ...result, width: Math.round(width), height: Math.round(height) };
  } finally { URL.revokeObjectURL(url); }
}

function colorCode(element, text, language, colors) {
  element.replaceChildren();
  const spans = codeSpans(text, language);
  const palette = codePalette(language, colors);
  let offset = 0;
  for (const span of spans) {
    if (span.from > offset) element.append(document.createTextNode(text.slice(offset, span.from)));
    const token = document.createElement('span'); token.textContent = text.slice(span.from, span.to);
    const color = colorForClass(span.className, palette);
    if (color) token.style.color = color;
    element.append(token); offset = span.to;
  }
  if (offset < text.length) element.append(document.createTextNode(text.slice(offset)));
}

export async function prepareExport(source, { title = '文档', colors = {}, typography, readAsset, allowMissingImages = false, signal, onProgress = () => {} } = {}) {
  const parsed = parseDocument(source);
  const body = document.createElement('main');
  body.append(DOMSerializer.fromSchema(schema).serializeFragment(parsed.doc.content));
  const tableModels = [];
  parsed.doc.descendants(node => { if (node.type.name === 'table') { tableModels.push(node); return false; } });
  for (const [index, element] of [...body.querySelectorAll('table:not([data-front-matter])')].entries()) {
    const widths = tableColumnWidths(tableModels[index], 720, 14);
    const total = widths.reduce((sum, width) => sum + width, 0);
    element.querySelector('colgroup')?.remove();
    const columns = document.createElement('colgroup');
    for (const width of widths) { const column = document.createElement('col'); column.style.width = width / total * 100 + '%'; columns.append(column); }
    element.prepend(columns); element.style.tableLayout = 'fixed';
  }
  const headings = documentHeadings(parsed.doc);
  let headingIndex = 0;
  for (const element of body.children) if (/^H[1-6]$/.test(element.tagName)) element.id = headings[headingIndex++].id;
  for (const element of body.querySelectorAll('nav[data-toc]')) renderTableOfContents(element, headings);
  const images = new Map();
  const missingImages = new Map();
  const graphics = new Map();
  const jobs = [];
  for (const image of body.querySelectorAll('img')) jobs.push(async () => {
    const path = image.getAttribute('src');
    if (!images.has(path) && !missingImages.has(path)) {
      try {
        let dataUrl;
        if (/^data:image\/(png|jpeg|gif|webp|bmp);base64,/i.test(path)) dataUrl = path;
        else {
          if ((/^[a-z][a-z0-9+.-]*:|^\/\//i.test(path)) && !/^file:\/\/\//i.test(path) && !/^[a-z]:(?:[\\/]|%5c|%2f)/i.test(path)) throw new Error('非本地图片，请先通过插图功能导入。');
          if (!readAsset) throw new Error('无法读取本地图片。');
          const asset = await readAsset(path);
          dataUrl = `data:${asset.mime};base64,${asset.data}`;
        }
        images.set(path, { ...await rasterAsset(dataUrl, 720, Infinity), dataUrl });
      } catch (error) {
        signal?.throwIfAborted();
        if (error.name === 'AbortError') throw error;
        missingImages.set(path, { path, displayPath: /^data:/i.test(path) ? '内嵌图片' : readableImagePath(path), message: readableImagePath(error.message || '图片内容无法解码。') });
      }
    }
    if (missingImages.has(path)) {
      const placeholder = document.createElement('span'); placeholder.className = 'export-missing-image';
      placeholder.textContent = missingImageText(missingImages.get(path).displayPath, image.getAttribute('alt'));
      image.replaceWith(placeholder);
      return;
    }
    const asset = images.get(path);
    image.src = asset.dataUrl;
    image.width = asset.width; image.height = asset.height;
  });
  for (const element of body.querySelectorAll('[data-math], [data-mermaid]')) jobs.push(async () => {
    const kind = element.hasAttribute('data-mermaid') ? 'mermaid' : element.tagName === 'SPAN' ? 'math_inline' : 'math_block';
    const value = element.getAttribute(kind === 'mermaid' ? 'data-mermaid' : 'data-math');
    const key = graphicKey(kind, value);
    if (!graphics.has(key)) graphics.set(key, await rasterSvg(await renderMarkup(kind, value), kind === 'math_inline'));
    const graphic = graphics.get(key);
    const image = document.createElement('img'); image.src = graphic.dataUrl;
    image.width = graphic.width; image.height = graphic.height;
    image.alt = kind === 'mermaid' ? '图表' : value; image.className = 'export-graphic';
    element.replaceChildren(image);
    element.removeAttribute('data-math'); element.removeAttribute('data-mermaid');
  });
  let codeIndex = 0;
  const codeElements = [...body.querySelectorAll('pre > code')];
  if (codeElements.length) await prepareCodeHighlighting();
  parsed.doc.descendants(node => {
    if (node.type.name === 'code_block') colorCode(codeElements[codeIndex++], node.textContent, node.attrs.params, colors);
  });
  for (let index = 0; index < jobs.length; index++) {
    signal?.throwIfAborted();
    onProgress(index + 1, jobs.length);
    await jobs[index]();
  }
  signal?.throwIfAborted();
  if ([...missingImages.keys()].some(path => allowMissingImages !== true && !allowMissingImages?.has?.(path))) {
    const issues = [...missingImages.values()];
    const details = issues.slice(0, 8).map((issue, index) => `${index + 1}. ${issue.displayPath}\n${issue.message}`).join('\n');
    const remaining = issues.length > 8 ? `\n另有 ${issues.length - 8} 张，继续导出后在原位置保留缺图说明。` : '';
    const error = new Error(`${issues.length} 张图片无法读取：\n${details}${remaining}\n\n选择“继续导出”将保留有效图片，并在缺图位置注明原引用。`);
    error.name = 'ImageExportError'; error.issues = issues;
    throw error;
  }
  for (const link of body.querySelectorAll('a')) link.setAttribute('rel', 'noopener noreferrer');
  const titleElement = document.createElement('span'); titleElement.textContent = title;
  const sanitized = DOMPurify.sanitize(body.innerHTML, { ADD_DATA_URI_TAGS: ['img'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed'], FORBID_ATTR: ['contenteditable', 'onclick', 'onload'] });
  const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>${titleElement.innerHTML}</title><style>${exportCss}${navigationCss}${noteCss}</style></head><body><main>${sanitized}</main></body></html>`;
  return { title, doc: parsed.doc, html, images, missingImages, graphics, colors, typography };
}

export async function createWord(snapshot) {
  const { Document, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, Packer, HeadingLevel, WidthType, AlignmentType, BorderStyle, LevelFormat, ExternalHyperlink, InternalHyperlink, Bookmark, PageBreak, TableLayoutType } = await import('docx');
  const bodyType = { font: 'Literata', eastAsia: 'SimSun', fontSize: 18, lineHeight: 2.05, marginTop: 18, marginBottom: 18, color: '303831', ...snapshot.typography?.body };
  const headingTypes = Array.from({ length: 6 }, (_, index) => {
    const ratio = [1.65, 1.25, 1.1, 1, .9, .85][index];
    return { ...bodyType, fontSize: bodyType.fontSize * ratio, lineHeight: 1.6, marginTop: bodyType.fontSize * 1.5, marginBottom: bodyType.fontSize * .7, bold: true, ...snapshot.typography?.headings?.[index + 1] };
  });
  const wordStyle = style => ({
    run: { font: { ascii: style.font, hAnsi: style.font, eastAsia: style.eastAsia || style.font, cs: style.font }, size: Math.round(style.fontSize * 1.5), color: style.color, bold: !!style.bold },
    paragraph: { spacing: { before: Math.round(style.marginTop * 15), after: Math.round(style.marginBottom * 15), line: Math.round(style.lineHeight * 240), lineRule: 'auto' } },
  });
  const bodyStyle = wordStyle(bodyType);
  const tableType = { ...bodyType, fontSize: bodyType.fontSize * .82, lineHeight: 1.85, marginTop: 0, marginBottom: 0, ...snapshot.typography?.table };
  const quoteType = { ...bodyType, fontSize: Math.max(14, bodyType.fontSize * .92), color: '405766', ...snapshot.typography?.quote };
  const codeType = { ...bodyType, font: 'Consolas', fontSize: 13, lineHeight: 1.65, ...snapshot.typography?.code };
  const paragraphStyles = [
    { id: 'Normal', name: 'Normal', quickFormat: true, ...bodyStyle },
    { id: 'InkletTable', name: 'Inklet Table', basedOn: 'Normal', ...wordStyle(tableType) },
    { id: 'InkletTableHeader', name: 'Inklet Table Header', basedOn: 'InkletTable', run: { bold: true } },
    { id: 'InkletQuote', name: 'Inklet Quote', basedOn: 'Normal', ...wordStyle(quoteType) },
    ...headingTypes.map((style, index) => ({ id: 'Heading' + (index + 1), name: 'Heading ' + (index + 1), basedOn: 'Normal', next: 'Normal', quickFormat: true, ...wordStyle(style), paragraph: { ...wordStyle(style).paragraph, outlineLevel: index, keepNext: true, keepLines: true } })),
  ];
  const headings = documentHeadings(snapshot.doc);
  const headingIds = new Map(headings.map(heading => [snapshot.doc.nodeAt(heading.position), heading.id]));
  let hasCode = false;
  snapshot.doc.descendants(node => { if (node.type.name === 'code_block') hasCode = true; });
  if (hasCode) await prepareCodeHighlighting();
  const imageRun = (asset, maxWidth = 9866 / 15) => {
    if (!asset) throw new Error('Word 图片资源缺失。');
    const ratio = Math.min(1, maxWidth / asset.width, 780 / asset.height);
    return new ImageRun({ type: 'png', data: bytesFromBase64(asset.data), transformation: { width: Math.max(1, Math.round(asset.width * ratio)), height: Math.max(1, Math.round(asset.height * ratio)) } });
  };
  const plainRuns = (value, options = {}) => String(value).split('\n').flatMap((line, index) => [
    ...(index ? [new TextRun({ ...options, break: 1 })] : []),
    ...(line ? [new TextRun({ ...options, text: line })] : []),
  ]);
  const inline = (node, maxWidth) => {
    const runs = [];
    node.forEach(child => {
      if (child.isText) {
        const options = { text: child.text };
        for (const mark of child.marks) {
          if (mark.type.name === 'strong') options.bold = true;
          if (mark.type.name === 'em') options.italics = true;
          if (mark.type.name === 'strike') options.strike = true;
          if (mark.type.name === 'code') { options.font = codeType.font; }
        }
        const run = new TextRun(options);
        const link = child.marks.find(mark => mark.type.name === 'link');
        runs.push(link ? new ExternalHyperlink({ link: link.attrs.href, children: [run] }) : run);
      } else if (child.type.name === 'hard_break') runs.push(new TextRun({ break: 1 }));
      else if (child.type.name === 'image') {
        const issue = snapshot.missingImages?.get(child.attrs.src);
        runs.push(issue ? new TextRun({ text: missingImageText(issue.displayPath, child.attrs.alt), italics: true }) : imageRun(snapshot.images.get(child.attrs.src), maxWidth));
      }
      else if (child.type.name === 'math_inline') runs.push(imageRun(snapshot.graphics.get(graphicKey('math_inline', child.attrs.tex)), maxWidth));
    });
    return runs;
  };
  const numberings = [];
  let listIndex = 0;
  const blocks = (container, context = {}) => {
    const output = [];
    container.forEach(node => {
      const kind = node.type.name;
      if (kind === 'paragraph' || kind === 'heading') {
        const maxWidth = Math.max(1, (context.width || 9866 / 15) - (context.indent || 0) / 15 - (context.list ? 32 * ((context.depth || 0) + 1) : 0));
        const options = { children: inline(node, maxWidth) };
        if (context.cell) options.style = context.header ? 'InkletTableHeader' : 'InkletTable';
        else if (context.quote) options.style = 'InkletQuote';
        if (headingIds.has(node)) options.children = [new Bookmark({ id: headingIds.get(node), children: options.children })];
        if (node.childCount === 1 && node.firstChild.type.name === 'image') options.alignment = AlignmentType.CENTER;
        const alignment = textAlignment(node.attrs.textAlign || context.textAlign);
        if (alignment) options.alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED, start: AlignmentType.LEFT, end: AlignmentType.RIGHT }[alignment];
        if (kind === 'heading') { options.heading = HeadingLevel['HEADING_' + node.attrs.level]; options.keepNext = true; }
        if (context.indent) options.indent = { left: context.indent };
        if (context.list) { options.numbering = { reference: context.list, level: Math.min(context.depth || 0, 8) }; options.spacing = { before: Math.round(bodyType.fontSize * .25 * 15), after: Math.round(bodyType.fontSize * .25 * 15), line: Math.round(bodyType.lineHeight * 240) }; context = { ...context, list: null }; }
        output.push(new Paragraph(options));
      } else if (kind === 'toc') {
        const firstLevel = Math.min(6, ...headings.map(heading => heading.level));
        for (const heading of headings) output.push(new Paragraph({
          children: [new InternalHyperlink({ anchor: heading.id, children: [new TextRun({ text: heading.text, style: 'Hyperlink' })] })],
          indent: { left: Math.max(0, heading.level - firstLevel) * 240 }, spacing: { after: 100, line: 300 },
        }));
      } else if (kind === 'page_break') {
        output.push(new Paragraph({ children: [new PageBreak()], spacing: { after: 0, before: 0 } }));
      } else if (kind === 'code_block') {
        const runs = [];
        const palette = codePalette(node.attrs.params, snapshot.colors);
        let offset = 0;
        const add = (text, color) => {
          const lines = text.split('\n');
          lines.forEach((line, index) => {
            if (index) runs.push(new TextRun({ break: 1 }));
            if (line) runs.push(new TextRun({ text: line, font: codeType.font, size: Math.round(codeType.fontSize * 1.5), color: color?.slice(1) }));
          });
        };
        for (const span of codeSpans(node.textContent, node.attrs.params)) {
          if (span.from > offset) add(node.textContent.slice(offset, span.from));
          add(node.textContent.slice(span.from, span.to), colorForClass(span.className, palette));
          offset = span.to;
        }
        add(node.textContent.slice(offset));
        output.push(new Paragraph({ children: runs, shading: { fill: 'F3F6F2' }, ...wordStyle(codeType).paragraph }));
      } else if (kind === 'math_block' || kind === 'mermaid') {
        output.push(new Paragraph({ children: [imageRun(snapshot.graphics.get(graphicKey(kind, kind === 'mermaid' ? node.attrs.code : node.attrs.tex)), context.width)], alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 } }));
      } else if (kind === 'front_matter') {
        const border = { style: BorderStyle.SINGLE, size: 4, color: 'BDCEBF' };
        const rows = node.attrs.entries.map(entry => new TableRow({ children: [
          new TableCell({ children: [new Paragraph({ style: 'InkletTableHeader', children: plainRuns(entry.key, { bold: true }) })], shading: { fill: 'EEF3ED' }, margins: { top: 90, bottom: 90, left: 120, right: 120 } }),
          new TableCell({ children: [new Paragraph({ style: 'InkletTable', children: plainRuns(entry.value) })], margins: { top: 90, bottom: 90, left: 120, right: 120 } }),
        ] }));
        output.push(new Table({ rows, columnWidths: [2600, 7266], layout: TableLayoutType.FIXED, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border } }));
      } else if (kind === 'table') {
        const measured = tableColumnWidths(node, 658, tableType.fontSize);
        const totalWidth = measured.reduce((sum, width) => sum + width, 0);
        const columnWidths = measured.map(width => Math.round(width / totalWidth * 9866));
        const map = TableMap.get(node);
        const rows = [];
        node.forEach((row, rowOffset) => {
          const children = [];
          row.forEach((cell, cellOffset) => {
            const rectangle = map.findCell(rowOffset + cellOffset + 1);
            const width = Math.max(1, (columnWidths.slice(rectangle.left, rectangle.right).reduce((sum, size) => sum + size, 0) - 240) / 15);
            children.push(new TableCell({ children: blocks(cell, { cell: true, header: cell.type.name === 'table_header', textAlign: cell.attrs.textAlign, width }), columnSpan: cell.attrs.colspan, rowSpan: cell.attrs.rowspan, shading: cell.type.name === 'table_header' ? { fill: 'EEF3ED' } : undefined, margins: { top: 90, bottom: 90, left: 120, right: 120 } }));
          });
          rows.push(new TableRow({ children, tableHeader: row.content.content.every(cell => cell.type.name === 'table_header') }));
        });
        const border = { style: BorderStyle.SINGLE, size: 4, color: 'BDCEBF' };
        output.push(new Table({ rows, columnWidths, layout: TableLayoutType.FIXED, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border } }));
      } else if (kind === 'bullet_list' || kind === 'ordered_list') {
        const reference = 'list-' + ++listIndex;
        numberings.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({ level, format: kind === 'bullet_list' ? LevelFormat.BULLET : LevelFormat.DECIMAL, text: kind === 'bullet_list' ? '\u2022' : '%' + (level + 1) + '.', start: node.attrs.order || 1, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 480 * (level + 1), hanging: 240 } } } })) });
        node.forEach(item => output.push(...blocks(item, { ...context, list: reference, depth: context.depth || 0 })));
      } else if (kind === 'blockquote') output.push(...blocks(node, { ...context, quote: true, indent: 480 }));
      else if (kind === 'horizontal_rule') output.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BDCEBF' } } }));
    });
    return output;
  };
  const children = blocks(snapshot.doc);
  const document = new Document({ title: snapshot.title, creator: '', description: '',
    styles: { default: { document: bodyStyle }, paragraphStyles },
    numbering: { config: numberings },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1020, bottom: 1020, left: 1020, right: 1020 } } }, children }],
  });
  return Packer.toBase64String(document);
}