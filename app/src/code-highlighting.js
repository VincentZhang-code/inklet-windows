let highlighter;
let loading;
const listeners = new Set();
export const codeLanguages = [
  ['plaintext', 'Plain Text'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['python', 'Python'],
  ['java', 'Java'], ['csharp', 'C#'], ['cpp', 'C / C++'], ['go', 'Go'], ['rust', 'Rust'], ['sql', 'SQL'],
  ['json', 'JSON'], ['xml', 'HTML / XML'], ['css', 'CSS'], ['bash', 'Shell'], ['yaml', 'YAML'], ['markdown', 'Markdown'],
];
const aliases = { js: 'javascript', ts: 'typescript', py: 'python', cs: 'csharp', 'c#': 'csharp', c: 'cpp', 'c++': 'cpp', sh: 'bash', shell: 'bash', html: 'xml', yml: 'yaml', text: 'plaintext', txt: 'plaintext' };
export const codeColorDefaults = { keyword: '#9A365C', string: '#337448', comment: '#6B7867', number: '#99622B', function: '#286B91', type: '#73579D' };
export const codeColorLabels = { keyword: '关键字', string: '字符串', comment: '注释', number: '数字', function: '函数', type: '类型' };
const cache = new Map();

export function prepareCodeHighlighting() {
  if (!loading) loading = import('./code-highlighting-engine.js').then(module => {
    highlighter = module;
    for (const listener of listeners) listener();
    return module;
  }).catch(error => { loading = null; throw error; });
  return loading;
}

export function onCodeHighlightingReady(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function normalizeLanguage(value) {
  const name = String(value || 'plaintext').trim().split(/\s+/)[0].toLowerCase();
  return aliases[name] || name;
}

export function codePalette(language, settings = {}) {
  const colors = { ...codeColorDefaults, ...settings.default, ...settings[normalizeLanguage(language)] };
  for (const name of Object.keys(colors)) if (!/^#[0-9a-f]{6}$/i.test(colors[name])) colors[name] = codeColorDefaults[name];
  return colors;
}

export function codeStyle(language, settings = {}) {
  return Object.entries(codePalette(language, settings)).map(([name, color]) => `--code-${name}:${color}`).join(';');
}

export function codeSpans(text, language) {
  language = normalizeLanguage(language);
  if (language === 'plaintext' || text.length > 200000) return [];
  if (!highlighter) { prepareCodeHighlighting().catch(() => {}); return []; }
  const key = language + '\0' + text;
  if (cache.has(key)) return cache.get(key);
  let result;
  try { result = highlighter.highlightCode(text, language); }
  catch { return []; }
  cache.set(key, result);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return result;
}

export function colorForClass(className, palette) {
  if (/hljs-(comment|quote)/.test(className)) return palette.comment;
  if (/hljs-(string|regexp)/.test(className)) return palette.string;
  if (/hljs-(number|literal)/.test(className)) return palette.number;
  if (/hljs-(keyword|selector-tag|doctag)/.test(className)) return palette.keyword;
  if (/hljs-(type|built_in)/.test(className)) return palette.type;
  if (/hljs-(title|name)/.test(className)) return palette.function;
  return null;
}