export const interfaceFamilies = { clear: '清透色系', dark: '暗色色系', candy: '糖果色系', morandi: '莫兰迪色系' };
export const paperFamilies = { book: '书卷色系', dark: '暗色色系' };

export const interfaceThemes = {
  jade: { name: '玉露绿', family: 'clear', base: '#d8eadf', secondary: '#dce8f0', ink: '#254b3c', muted: '#657d70', accent: '#2c7458' },
  white: { name: '纯白', family: 'clear', base: '#f5f6f8', secondary: '#e0e7ee', ink: '#36434c', muted: '#737f88', accent: '#4f718b' },
  orange: { name: '蜜橙', family: 'clear', base: '#ffe2c6', secondary: '#f6e1e8', ink: '#70472d', muted: '#94715d', accent: '#ae642f' },
  blue: { name: '浅蓝', family: 'clear', base: '#dcecff', secondary: '#dbf0eb', ink: '#325873', muted: '#6d8799', accent: '#347baa' },
  graphite: { name: '石墨', family: 'dark', base: '#202326', secondary: '#30373b', ink: '#edf0f2', muted: '#abb7bd', accent: '#a5d4c4' },
  pine: { name: '松墨', family: 'dark', base: '#1c2825', secondary: '#303933', ink: '#e7efeb', muted: '#a6bcb0', accent: '#b4d2b6' },
  plum: { name: '烟墨', family: 'dark', base: '#2a2528', secondary: '#373236', ink: '#f0e9ec', muted: '#c2afb8', accent: '#ddb6c3' },
  candy: { name: '莓果糖', family: 'candy', base: '#f7ddea', secondary: '#d9eef7', ink: '#704b64', muted: '#826278', accent: '#a95885' },
  mint: { name: '薄荷糖', family: 'candy', base: '#daf1e5', secondary: '#e3f0f8', ink: '#355d4d', muted: '#617f70', accent: '#397d63' },
  lemon: { name: '柠檬糖', family: 'candy', base: '#f8efc9', secondary: '#e8f2e5', ink: '#625c30', muted: '#80774e', accent: '#827332' },
  peach: { name: '蜜桃糖', family: 'candy', base: '#fbded6', secondary: '#f5e0ea', ink: '#765247', muted: '#906c63', accent: '#a45f53' },
  sage: { name: '灰绿', family: 'morandi', base: '#dde3dd', secondary: '#d4ddd9', ink: '#465b50', muted: '#6c7c73', accent: '#506e5e' },
  mist: { name: '雾蓝', family: 'morandi', base: '#dde3e6', secondary: '#d0dadd', ink: '#465c67', muted: '#6c7e86', accent: '#537484' },
  rose: { name: '烟粉', family: 'morandi', base: '#e8dddd', secondary: '#dbd0d3', ink: '#675156', muted: '#847176', accent: '#885e6b' },
  stone: { name: '暖灰', family: 'morandi', base: '#e4e1dc', secondary: '#d6d7d1', ink: '#585a50', muted: '#777b70', accent: '#686e5c' },
};

export const paperThemes = {
  white: { name: '纯白', value: '#ffffff', paper: false, family: 'book' },
  gray: { name: '浅灰', value: '#f3f4f6', paper: false, family: 'book' },
  cyan: { name: '天青纸', value: '#e8efeb', paper: true, family: 'book' },
  ink: { name: '淡墨水', value: '#eef1f5', paper: false, family: 'book' },
  paper: { name: '宣纸白', value: '#f3f3ed', paper: true, family: 'book' },
  'ink-paper': { name: '淡墨纸', value: '#e5e9e7', paper: true, family: 'book' },
  graphite: { name: '石墨纸', value: '#202326', paper: false, family: 'dark', ink: '#e0e5e8', muted: '#9caab2', accent: '#a9d4c4' },
  pine: { name: '松墨纸', value: '#1c2825', paper: false, family: 'dark', ink: '#dfe9e2', muted: '#a0b7a9', accent: '#b3d6b9' },
  plum: { name: '烟墨纸', value: '#2a2528', paper: false, family: 'dark', ink: '#ece2e6', muted: '#beabb4', accent: '#e1b7c8' },
};

export function paneCodeColors(theme, custom = {}) {
  if (paperThemes[theme]?.family !== 'dark') return custom;
  return { ...custom, default: { keyword: '#e7a9c4', string: '#aed5a4', comment: '#a4b1bc', number: '#edc38a', function: '#9dcfe6', type: '#ccb8e7', ...custom.default } };
}