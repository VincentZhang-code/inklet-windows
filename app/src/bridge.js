const pending = new Map();
const assets = new Map();
let sequence = 0;
let fileHandle;
let directoryHandle;
let fileStamp;
let activeDocumentId = null;
const browserDocuments = new Map();
let sessionDatabase;
export const desktop = !!window.chrome?.webview;

export function selectDocument(id) {
  activeDocumentId = id;
  if (!desktop && id && !browserDocuments.has(id)) browserDocuments.set(id, { id, name: '未命名.md', path: null, handle: null, stamp: null });
}

async function sessionStorageOperation(mode, id, value) {
  if (!sessionDatabase) sessionDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open('inklet.workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const database = await sessionDatabase;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('sessions', mode === 'read' ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = mode === 'read' ? store.get(id) : mode === 'delete' ? store.delete(id) : store.put(value, id);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('文档缓存写入已取消。'));
  });
}

export async function digest(text) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

if (desktop) window.chrome.webview.addEventListener('message', event => {
  const message = event.data;
  if (message.event) { window.dispatchEvent(new CustomEvent('inklet:' + message.event, { detail: message.data })); return; }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.result);
});

async function writeFile(handle, text) {
  const writer = await handle.createWritable();
  try { await writer.write(text); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}

async function browserCall(command, args) {
  const documentId = args.documentId || activeDocumentId;
  const owner = browserDocuments.get(documentId);
  if (command === 'hello') {
    return { settings: JSON.parse(localStorage.getItem('inklet.settings') || '{}'), document: null, recent: [], workspace: true };
  }
  if (command === 'workspaceList') return [...browserDocuments.values()].map(({ id, name, path }) => ({ id, name, path }));
  if (command === 'activateDocument') { selectDocument(documentId); return true; }
  if (command === 'storeSession') {
    await sessionStorageOperation('write', documentId, args.snapshot);
    return { documentId, revision: args.snapshot.session.revision, persisted: true };
  }
  if (command === 'readSession') return sessionStorageOperation('read', documentId);
  if (command === 'releaseDocument' || command === 'cancelClose') return true;
  if (command === 'closeDocuments') {
    for (const id of args.ids) {
      await sessionStorageOperation('delete', id);
      browserDocuments.delete(id);
      for (const [key, url] of assets) if (key.startsWith(id + ':')) { URL.revokeObjectURL(url); assets.delete(key); }
    }
    return true;
  }
  if (command === 'history') return [];
  if (command === 'open') {
    const handles = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.txt'] } }] });
    const documents = [];
    for (const handle of handles) {
      let existing;
      for (const candidate of browserDocuments.values()) if (candidate.handle && await candidate.handle.isSameEntry(handle)) { existing = candidate; break; }
      if (!existing) {
        const id = crypto.randomUUID().replaceAll('-', '');
        existing = { id, name: handle.name, path: 'browser:' + id + '/' + handle.name, handle, stamp: null };
        browserDocuments.set(id, existing);
      }
      documents.push({ id: existing.id, name: existing.name, path: existing.path });
    }
    return { documents };
  }
  if (command === 'loadDocument') {
    if (!owner) throw new Error('文档已关闭。');
    if (!owner.handle) return { id: owner.id, name: owner.name, path: null, text: '' };
    const file = await owner.handle.getFile();
    const text = (await file.text()).replace(/\r\n/g, '\n');
    owner.stamp = { modified: file.lastModified, size: file.size };
    const cached = JSON.parse(localStorage.getItem('inklet.marks.' + owner.id) || 'null');
    return { id: owner.id, name: file.name, path: owner.path, text, hash: await digest(text), annotations: cached };
  }
  if (command === 'new') {
    const id = crypto.randomUUID().replaceAll('-', '');
    browserDocuments.set(id, { id, name: '未命名.md', path: null, handle: null, stamp: null });
    return { id, name: '未命名.md', text: '', placeholder: args.placeholder === true };
  }
  if (command === 'save') {
    if (!owner) throw new Error('文档已关闭。');
    const handle = !owner.handle || args.saveAs ? await window.showSaveFilePicker({ suggestedName: args.name || 'Untitled.md', types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }] }) : owner.handle;
    for (const candidate of browserDocuments.values()) if (candidate.id !== documentId && candidate.handle && await candidate.handle.isSameEntry(handle)) throw new Error('目标文件已在工作空间打开，请选择其他文件名。');
    if (owner.stamp && !args.saveAs) {
      const file = await handle.getFile();
      if (file.lastModified !== owner.stamp.modified || file.size !== owner.stamp.size) throw new Error('磁盘文件已被其他程序修改，请另存为以保留双方内容。');
    }
    await writeFile(handle, args.text);
    const hash = await digest(args.text);
    localStorage.setItem('inklet.marks.' + owner.id, JSON.stringify({ ...args.annotations, textHash: hash }));
    const file = await handle.getFile();
    owner.handle = handle; owner.name = handle.name; owner.path = 'browser:' + owner.id + '/' + handle.name;
    owner.stamp = { modified: file.lastModified, size: file.size };
    return { documentId, path: owner.path, name: owner.name, hash };
  }
  if (command === 'importImage') {
    if (!owner) throw new Error('文档已关闭。');
    if (!owner.directoryHandle) owner.directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const folder = await owner.directoryHandle.getDirectoryHandle('.inklet-assets', { create: true });
    const bytes = Uint8Array.from(atob(args.data), character => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: args.mime });
    const name = (await digest(args.data)).slice(0, 20) + '.' + (args.mime === 'image/jpeg' ? 'jpg' : args.mime.split('/')[1]);
    const handle = await folder.getFileHandle(name, { create: true });
    await writeFile(handle, blob);
    const path = '.inklet-assets/' + name;
    assets.set(documentId + ':' + path, URL.createObjectURL(blob));
    return { path, name: args.name };
  }
  if (command === 'settings') { localStorage.setItem('inklet.settings', JSON.stringify(args)); return true; }
  if (command === 'readAsset') {
    const url = assetUrl(args.path, documentId);
    if (!url) throw new Error('浏览器预览无法读取此本地图片，请使用桌面版导出。');
    const response = await fetch(url);
    if (!response.ok) throw new Error('图片读取失败。');
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { mime: blob.type, data: dataUrl.split(',')[1] };
  }
  if (command === 'export') {
    if (args.format === 'pdf') throw new Error('PDF 导出请使用 Inklet 桌面版。');
    const mime = args.format === 'html' ? 'text/html' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const blob = args.format === 'html' ? new Blob([args.html], { type: mime }) : new Blob([Uint8Array.from(atob(args.data), character => character.charCodeAt(0))], { type: mime });
    const name = args.name.replace(/\.(md|markdown|txt)$/i, '') + '.' + args.format;
    const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: args.format.toUpperCase(), accept: { [mime]: ['.' + args.format] } }] });
    await writeFile(handle, blob);
    return { path: handle.name, format: args.format };
  }
  if (command === 'state' || command === 'draft' || command === 'searchState') return true;
  if (command === 'external') { window.open(args.url, '_blank', 'noopener,noreferrer'); return true; }
  if (command === 'print') { window.print(); return true; }
  throw new Error('此操作需要 Inklet 桌面版。');
}

export function call(command, args = {}) {
  args = { documentId: activeDocumentId, ...args };
  if (!desktop) return browserCall(command, args);
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    window.chrome.webview.postMessage({ id, command, args });
  });
}

export function assetUrl(source, documentId = activeDocumentId) {
  if (assets.has(documentId + ':' + source)) return assets.get(documentId + ':' + source);
  if (/^data:image\/(png|jpeg|webp|gif|bmp);base64,/i.test(source)) return source;
  if (/^(https?:|javascript:|data:|\/\/)/i.test(source)) return '';
  if (desktop) return 'https://inklet-files.local/image?' + new URLSearchParams({ document: documentId || '', path: source.replaceAll('\\', '/') });
  return source.startsWith('/samples/') ? source : '';
}