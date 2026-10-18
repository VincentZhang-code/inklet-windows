export const shortcutCommands = [
  { id: 'new', label: '\u65b0\u5efa', shortcut: 'Ctrl+N' },
  { id: 'open', label: '\u6253\u5f00', shortcut: 'Ctrl+O' },
  { id: 'save', label: '\u4fdd\u5b58', shortcut: 'Ctrl+S' },
  { id: 'save-as', label: '\u53e6\u5b58\u4e3a', shortcut: 'Ctrl+Shift+S' },
  { id: 'search', label: '\u67e5\u627e\u4e0e\u66ff\u6362', shortcut: 'Ctrl+F' },
  { id: 'undo', label: '\u64a4\u9500', shortcut: 'Ctrl+Z' },
  { id: 'redo', label: '\u91cd\u505a', shortcut: 'Ctrl+Y' },
  { id: 'bold', label: '\u52a0\u7c97', shortcut: 'Ctrl+B' },
  { id: 'italic', label: '\u659c\u4f53', shortcut: 'Ctrl+I' },
  { id: 'sidebar', label: '\u663e\u793a\u6216\u9690\u85cf\u5927\u7eb2', shortcut: 'Ctrl+Shift+O' },
  { id: 'focus', label: '\u4e13\u6ce8\u6a21\u5f0f', shortcut: 'F8' },
  { id: 'typewriter', label: '\u6253\u5b57\u673a\u6a21\u5f0f', shortcut: 'F9' },
  { id: 'print', label: '\u5bfc\u51fa\u6587\u6863', shortcut: 'Ctrl+P' },
  { id: 'about', label: '\u8f6f\u4ef6\u8bf4\u660e', shortcut: 'F1' },
];

const reserved = new Set(['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+W', 'Ctrl+L', 'Ctrl+Tab', 'Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete', 'F5']);
export function shortcutFromEvent(event) {
  if (event.isComposing || event.keyCode === 229 || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(event.key) || event.getModifierState?.('AltGraph')) return '';
  let key = event.code?.startsWith('Key') ? event.code.slice(3) : event.code?.startsWith('Digit') ? event.code.slice(5) : event.key;
  if (!key || key.length === 1 && !/[a-z0-9]/i.test(key)) return '';
  if (key.length === 1) key = key.toUpperCase();
  return [event.ctrlKey || event.metaKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
}

export function shortcutFor(command, overrides = {}) {
  return Object.prototype.hasOwnProperty.call(overrides, command.id) ? overrides[command.id] : command.shortcut;
}

export function validateShortcuts(overrides = {}) {
  const used = new Map();
  for (const command of shortcutCommands) {
    const shortcut = shortcutFor(command, overrides);
    if (!shortcut) continue;
    if (typeof shortcut !== 'string' || !/^(?:(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Enter|Delete|Backspace))$/.test(shortcut)) return { command: command.id, reason: 'invalid' };
    if (!shortcut.startsWith('Ctrl+') && !shortcut.startsWith('Alt+') && !/^F(?:[1-9]|1[0-2])$/.test(shortcut)) return { command: command.id, reason: 'modifier' };
    if (reserved.has(shortcut)) return { command: command.id, reason: 'reserved' };
    if (used.has(shortcut)) return { command: command.id, reason: 'duplicate', other: used.get(shortcut) };
    used.set(shortcut, command.id);
  }
  return null;
}

export function commandFromEvent(event, overrides = {}) {
  const shortcut = shortcutFromEvent(event);
  if (!shortcut) return null;
  const match = shortcutCommands.find(command => shortcutFor(command, overrides) === shortcut);
  if (match) return match.id;
  if (shortcut === 'Ctrl+Shift+Z' && !Object.prototype.hasOwnProperty.call(overrides, 'redo')) return 'redo';
  return null;
}