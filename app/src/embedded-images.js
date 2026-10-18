import { Fragment } from 'prosemirror-model';
import { parseDocument, schema, serializer } from './markdown.js';
import { minimalChange } from '../../core/document.mjs';

const embedded = /^data:image\/(?:png|jpeg|gif|webp);base64,/i;
const supported = /^image\/(?:png|jpeg|gif|webp)$/i;

export async function embedDocumentImages(source, { readAsset, convertAsset, maxBytes = 24 * 1024 * 1024 } = {}) {
  const parsed = parseDocument(source);
  const images = [];
  parsed.doc.descendants(node => { if (node.type.name === 'image') images.push(node); });
  const replacements = new Map();
  const encoder = new TextEncoder();
  let projected = encoder.encode(source).length;
  if (projected > maxBytes) throw new Error('文档已超过内嵌保存的大小上限。');
  for (const node of images) {
    const reference = node.attrs.src;
    if (embedded.test(reference) || replacements.has(reference)) continue;
    if (!readAsset) throw new Error('无法读取待内嵌的图片。');
    let asset;
    try {
      asset = await readAsset(reference);
      if (!supported.test(asset.mime)) {
        if (!convertAsset) throw new Error('此图片格式需要转换后才能内嵌。');
        asset = await convertAsset(asset, reference);
      } else if (convertAsset) asset = await convertAsset(asset, reference);
      if (!supported.test(asset.mime) || typeof asset.data !== 'string' || !/^[a-z\d+/]+={0,2}$/i.test(asset.data) || asset.data.length % 4 !== 0) throw new Error('图片数据无效。');
    } catch (error) {
      throw new Error('无法内嵌图片 ' + reference + '：' + error.message);
    }
    const dataUrl = 'data:' + asset.mime.toLowerCase() + ';base64,' + asset.data;
    const count = images.filter(image => image.attrs.src === reference).length;
    projected += Math.max(0, dataUrl.length - encoder.encode(reference).length) * count;
    if (projected > maxBytes) throw new Error('内嵌后MD超过24MiB上限，请减少或压缩图片，或关闭内嵌模式。');
    replacements.set(reference, dataUrl);
  }
  if (!replacements.size) return { source, changes: [], images: 0, bytes: projected };
  const convertNode = node => {
    if (node.type.name === 'image' && replacements.has(node.attrs.src)) return node.type.create({ ...node.attrs, src: replacements.get(node.attrs.src) }, node.content, node.marks);
    if (node.isLeaf) return node;
    const children = []; node.forEach(child => children.push(convertNode(child)));
    return node.copy(Fragment.from(children));
  };
  const changes = [];
  for (const range of parsed.ranges) {
    let affected = false;
    range.node.descendants(node => { if (node.type.name === 'image' && replacements.has(node.attrs.src)) affected = true; });
    if (!affected) continue;
    const node = convertNode(range.node);
    const original = source.slice(range.from, range.to);
    const trailing = original.match(/\n*$/)[0];
    const insert = serializer.serialize(schema.node('doc', null, [node])).replace(/\n*$/, '') + trailing;
    const change = minimalChange(original, insert);
    changes.push({ from: range.from + change.from, to: range.from + change.to, insert: change.insert });
  }
  let result = source;
  for (const change of [...changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  const bytes = encoder.encode(result).length;
  if (bytes > maxBytes) throw new Error('内嵌后MD超过24MiB上限，请减少或压缩图片。');
  const verified = parseDocument(result);
  let unresolved = 0;
  let imageCount = 0;
  verified.doc.descendants(node => { if (node.type.name === 'image') { imageCount++; if (!embedded.test(node.attrs.src)) unresolved++; } });
  if (unresolved || imageCount !== images.length) throw new Error('部分图片无法安全转换，原文档未改写。');
  return { source: result, changes, images: replacements.size, bytes };
}