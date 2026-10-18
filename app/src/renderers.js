import DOMPurify from 'dompurify';

let sequence = 0;
let mermaidPromise;
let diagramQueue = Promise.resolve();
let mathWorker;
const pending = new Map();
const cache = new Map();

function quotedEnd(text, start) {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') { index++; continue; }
    if (text[index] === quote) return index + 1;
  }
  return text.length;
}

export function quoteFlowchartLabels(source) {
  if (!/^\s*(?:flowchart|graph)\s+(?:TD|TB|BT|LR|RL)\b/.test(source)) return source;
  return source.replace(/[^\r\n]+/g, line => {
    if (/^\s*(?:%%|style\b|classDef\b|class\b|click\b|linkStyle\b|subgraph\b|end\b)/.test(line)) return line;
    let output = '';
    let position = 0;
    while (position < line.length) {
      if (['"', "'", '`', '|'].includes(line[position])) {
        const end = quotedEnd(line, position);
        output += line.slice(position, end); position = end; continue;
      }
      const identifier = /^[A-Za-z_][\w-]*/.exec(line.slice(position));
      const previous = position ? line[position - 1] : '';
      if (!identifier || /[\w.-]/.test(previous)) { output += line[position++]; continue; }
      const open = position + identifier[0].length;
      const delimiter = line[open];
      if (delimiter !== '[' && delimiter !== '{') { output += identifier[0]; position = open; continue; }
      const close = delimiter === '[' ? ']' : '}';
      let depth = 1;
      let cursor = open + 1;
      let nested = false;
      while (cursor < line.length && depth) {
        if (['"', "'", '`'].includes(line[cursor])) { cursor = quotedEnd(line, cursor); continue; }
        if (line[cursor] === delimiter) { depth++; nested = true; }
        if (line[cursor] === close) depth--;
        cursor++;
      }
      if (depth) { output += line.slice(position); break; }
      const label = line.slice(open + 1, cursor - 1);
      const unsupported = nested || /^\s*["'`/\\]/.test(label) || /[/\\]\s*$/.test(label);
      if (!unsupported && /[()]/.test(label)) {
        output += identifier[0] + delimiter + '"' + label.replaceAll('"', '#quot;') + '"' + close;
      } else output += line.slice(position, cursor);
      position = cursor;
    }
    return output;
  });
}

function namespaceSvg(html, prefix) {
  const holder = document.createElement('div');
  holder.innerHTML = DOMPurify.sanitize(html, { ADD_TAGS: ['mjx-container'], FORBID_TAGS: ['foreignObject', 'script'], FORBID_ATTR: ['onload', 'onclick'] });
  const ids = new Map();
  for (const element of holder.querySelectorAll('[id]')) {
    const previous = element.id;
    element.id = prefix + '-' + previous;
    ids.set(previous, element.id);
  }
  for (const element of holder.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'id') continue;
      let value = attribute.value;
      for (const [before, after] of ids) {
        value = value.replaceAll('url(#' + before + ')', 'url(#' + after + ')');
        if (value === '#' + before) value = '#' + after;
        if (['aria-labelledby', 'aria-describedby'].includes(attribute.name)) value = value.split(' ').map(part => part === before ? after : part).join(' ');
      }
      element.setAttribute(attribute.name, value);
    }
    if (element.tagName.toLowerCase() === 'style') {
      let content = element.textContent;
      for (const [before, after] of ids) content = content.replaceAll('#' + before, '#' + after);
      element.textContent = content;
    }
  }
  return holder.innerHTML;
}

function math(tex, display) {
  if (!mathWorker) {
    mathWorker = new Worker(new URL('./math-worker.js', import.meta.url), { type: 'module' });
    mathWorker.onmessage = event => {
      const request = pending.get(event.data.id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(event.data.id);
      if (event.data.error) request.reject(new Error(event.data.error));
      else request.resolve(event.data.svg);
    };
    mathWorker.onerror = event => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('公式引擎加载失败: ' + (event.message || '未知错误'))); }
      pending.clear();
      mathWorker?.terminate();
      mathWorker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('公式渲染超时'));
      if (!pending.size) { mathWorker?.terminate(); mathWorker = null; }
    }, 20000);
    pending.set(id, { resolve, reject, timer });
    mathWorker.postMessage({ id, tex, display });
  });
}

function diagram(code, theme) {
  const result = diagramQueue.then(() => drawDiagram(code, theme));
  diagramQueue = result.catch(() => {});
  return result;
}

async function drawDiagram(code, theme) {
  if (!mermaidPromise) mermaidPromise = import('mermaid').then(module => {
    const mermaid = module.default;
    return mermaid;
  });
  const mermaid = await mermaidPromise;
  await document.fonts.ready;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: theme === 'dark' ? 'dark' : 'neutral', fontFamily: 'Manrope, Microsoft YaHei, sans-serif', htmlLabels: false, layout: 'dagre', flowchart: { htmlLabels: false }, maxTextSize: 30000, maxEdges: 400 });
  let renderSource = code;
  let compatible = false;
  try { await mermaid.parse(code); }
  catch (error) {
    const candidate = quoteFlowchartLabels(code);
    if (candidate === code || !await mermaid.parse(candidate, { suppressErrors: true })) throw error;
    renderSource = candidate;
    compatible = true;
  }
  const svg = (await mermaid.render('inklet-diagram-' + ++sequence, renderSource)).svg;
  if (!compatible) return svg;
  const holder = document.createElement('div');
  holder.innerHTML = svg;
  holder.querySelector('svg')?.setAttribute('data-inklet-label-compat', 'quoted');
  return holder.innerHTML;
}

export async function renderMarkup(kind, value, theme = 'neutral') {
  const key = kind + ':' + (kind === 'mermaid' ? theme : 'neutral') + ':' + value;
  try {
    if (!cache.has(key)) {
      cache.set(key, { promise: kind === 'mermaid' ? diagram(value, theme) : math(value, kind === 'math_block'), markup: null });
      if (cache.size > 120) cache.delete(cache.keys().next().value);
    }
    const entry = cache.get(key);
    const markup = await entry.promise;
    entry.markup = markup;
    return namespaceSvg(markup, 'inklet-render-' + ++sequence);
  } catch (error) { cache.delete(key); throw error; }
}

export function renderOnVisible(element, kind, value, theme = 'neutral') {
  const key = kind + ':' + (kind === 'mermaid' ? theme : 'neutral') + ':' + value;
  element.dataset.renderKey = key;
  const cachedMarkup = cache.get(key)?.markup;
  if (cachedMarkup) {
    element.innerHTML = namespaceSvg(cachedMarkup, 'inklet-render-' + ++sequence);
    element.dataset.rendered = 'true';
    return () => {};
  }
  element.dataset.rendered = 'pending';
  element.textContent = kind === 'mermaid' ? '图表渲染中...' : value;
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    observer.disconnect();
    const render = async () => {
      if (!element.isConnected || element.dataset.renderKey !== key) return;
      try {
        const svg = await renderMarkup(kind, value, theme);
        if (element.isConnected && element.dataset.renderKey === key) {
          element.innerHTML = svg;
          element.dataset.rendered = 'true';
        }
      } catch (error) {
        cache.delete(key);
        if (element.dataset.renderKey === key) {
          element.textContent = value + '\n\n' + error.message;
          element.dataset.rendered = 'error';
        }
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(render, { timeout: 400 });
    else setTimeout(render, 0);
  }, { rootMargin: '160px' });
  observer.observe(element);
  return () => observer.disconnect();
}