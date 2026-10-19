import '@fontsource/manrope/400.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/600.css';
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-tables/style/tables.css';
import './inklet.css';
import { createIcons, FilePlus2, FolderOpen, Save, SaveAll, Download, PanelLeftClose, PanelLeftOpen, Code2, BookOpen, Search, Settings2, Info, Focus, AlignCenter, Undo2, Redo2, Bold, Italic, Strikethrough, Heading2, List, ListOrdered, Quote, ImagePlus, Table2, Sigma, Workflow, Link, Highlighter, X, ChevronUp, ChevronDown, Eraser, Columns2, Rows3, Trash2, FileText, MoreHorizontal, Printer, Check, ZoomIn, ZoomOut, ArrowUpRight, History, Maximize, ArrowUpToLine, CornerUpLeft } from 'lucide';
import { DocumentSession, highlightColors, minimalChange, serializeHighlights, restoreHighlights } from '../../core/document.mjs';
import { RecoveryWriter } from '../../core/recovery.mjs';
import { DocumentWorkspace, createDocumentState } from '../../core/workspace.mjs';
import { shortcutCommands, shortcutFor, shortcutFromEvent, validateShortcuts, commandFromEvent } from '../../core/shortcuts.mjs';
import { SourceEditor } from './source-editor.js';
import { RichEditor } from './rich-editor.js';
import { ScrollSynchronizer } from './scroll-sync.js';
import { ReadingPositionTracker, resolveReadingPosition } from './reading-position.js';
import { outlineOf, imageInsertion, wordStatistics } from './markdown.js';
import { call, assetUrl, desktop, digest, selectDocument } from './bridge.js';
import { sample } from './sample.js';
import { codeLanguages, codeColorDefaults, codeColorLabels, codePalette } from './code-highlighting.js';
import { headingIntent } from './document-toc.js';
import { groupSearchMatches } from './search-engine.js';
import { renderMarkup } from './renderers.js';
import { interfaceFamilies, interfaceThemes, paperFamilies, paperThemes as themes, paneCodeColors } from './appearance.js';
import { isImagePlaceholder } from './image-references.js';

const iconSet = { FilePlus2, FolderOpen, Save, SaveAll, Download, PanelLeftClose, PanelLeftOpen, Code2, BookOpen, Search, Settings2, Info, Focus, AlignCenter, Undo2, Redo2, Bold, Italic, Strikethrough, Heading2, List, ListOrdered, Quote, ImagePlus, Table2, Sigma, Workflow, Link, Highlighter, X, ChevronUp, ChevronDown, Eraser, Columns2, Rows3, Trash2, FileText, MoreHorizontal, Printer, Check, ZoomIn, ZoomOut, ArrowUpRight, History, Maximize, ArrowUpToLine, CornerUpLeft };
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const button = (name, label, action, extra = '') => `<button type="button" class="icon-button" title="${label}" aria-label="${label}" data-action="${action}" ${extra}>${icon(name)}</button>`;
const swatchNames = { yellow: '淡黄', green: '浅绿', blue: '天蓝', pink: '浅粉', orange: '淡橙' };
const backgroundOptions = side => Object.entries(themes).map(([name, theme]) => `<button type="button" class="theme-option" data-theme-side="${side}" data-theme="${name}" aria-pressed="false"><span data-paper="${theme.paper}" style="background-color:${theme.value}"></span>${theme.name}</button>`).join('');
const familyOptions = families => Object.entries(families).map(([key, name]) => `<option value="${key}">${name}</option>`).join('');
const readingFonts = {
  book: "'Literata', 'Noto Serif SC', 'Source Han Serif SC', 'STZhongsong', 'Songti SC', 'SimSun', serif",
  sans: "'Manrope', 'Noto Sans SC', 'Microsoft YaHei', sans-serif",
  kai: "'LXGW WenKai', 'KaiTi', 'STKaiti', 'Noto Serif SC', 'SimSun', serif",
};
const releaseNotes = [
  ['0.11.3', '保留序号换行，图片占位与缺图保存可确认', '2026-10-19'],
  ['0.11.2', '修复大文档表格加载与宽表横向滚动回弹', '2026-10-17'],
  ['0.11.1', '章节引用支持跳转，技能头部显示属性表', '2026-10-17'],
  ['0.11.0', '按文件记忆阅读位置，新增文首与恢复箭头', '2026-10-16'],
  ['0.10.1', '隔离浏览器快捷键，降低首次搜索冲突风险', '2026-10-15'],
  ['0.10.0', '图片自动读取，新增MD内嵌保存与影响提示', '2026-10-14'],
  ['0.9.1', '修复父目录图片读取，优化保存下拉字号', '2026-10-14'],
  ['0.9.0', '导航面板支持拖宽，目录随阅读章节同步', '2026-10-14'],
  ['0.8.0', '新增独立窗口开关，支持拖出文件安全拆分', '2026-10-13'],
  ['0.7.0', '新增多文档工作空间，独立恢复与有界缓存', '2026-10-12'],
  ['0.6.2', '品牌名称下新增轻快标语，两种发行同步更新', '2026-10-12'],
  ['0.6.1', '分离文档图标，修复版本关联并增加日期列', '2026-10-11'],
  ['0.6.0', '新增分层暗色主题，外部修改自动同步保护', '2026-10-11'],
  ['0.5.1', '修复图片导出，优化列宽与版本记录展示', '2026-10-11'],
  ['0.5.0', '导出排版随设置，新增五色主题及滚轮缩放', '2026-10-10'],
  ['0.4.4', '修复单栏搜索定位，新增按标题分组结果', '2026-10-10'],
  ['0.4.3', '修复备注和嵌套引用内表格长期停留占位', '2026-10-09'],
  ['0.4.2', '改善备注底色、目录定位及大图缩放阅读', '2026-10-09'],
  ['0.4.1', '采用透明标识，支持正文目录与分页导出', '2026-10-09'],
  ['0.4.0', '支持合并表格与按需加载，升级玻璃界面', '2026-10-09'],
  ['0.3.5', '新增另存为入口，按实际文字准确统计字数', '2026-10-09'],
  ['0.3.4', '默认恢复上次关闭文档，首次启动保持空白', '2026-10-09'],
  ['0.3.3', '新增打开历史与故障日志，加固搜索和恢复', '2026-10-09'],
  ['0.3.2', '修复源码与阅读区联动，改善长文滚动定位', null],
  ['0.3.1', '压缩静态资源并按需加载，降低启动负担', '2026-10-07'],
  ['0.3.0', '新增快捷键、高亮配色及完整文档导出功能', '2026-10-06'],
  ['0.2.0', '增加两栏独立背景，改善中文字体阅读排版', null],
];
let startupError;
const startupState = await call('hello').catch(error => { startupError = error; return {}; });
const startupSession = startupState.session || null;
const startupDocument = startupSession ? { ...startupSession.info, id: startupSession.documentId, text: startupSession.session.source } : startupState.document || (desktop ? { name: '未命名.md', text: '' } : { name: '写作手记.md', text: sample });
let documentSession = startupSession ? DocumentSession.restore(startupSession.session) : new DocumentSession(startupDocument.text || '');
const startupHighlights = restoreHighlights(documentSession.source, startupDocument.annotations?.marks, !!startupDocument.hash && startupDocument.annotations?.textHash === startupDocument.hash);
if (!startupSession) { documentSession.highlights = startupHighlights.highlights; documentSession.unresolved = startupHighlights.unresolved; }
let settings = { leftTheme: 'white', rightTheme: 'white', backgroundPaletteVersion: 1, interfaceTheme: 'jade', ctrlWheelZoom: true, separateWindows: false, embedImages: false, restoreReadingPosition: false, fontSize: 18, readingFont: 'book', lineHeight: 2.05, paragraphGap: 1, readingWidth: 720, paperTexture: true, opacity: 0.3, source: true, rich: true, sidebar: true, outlineSide: 'left', shortcuts: {}, focus: false, typewriter: false, syncScroll: true, searchResults: false, compress: false };
let documentInfo = { name: startupDocument.name, path: startupDocument.path || null, hash: startupDocument.hash || null };
let savedRevision = startupSession ? startupSession.savedRevision : startupDocument.restored ? -1 : 0;
let activePane = 'rich';
let selection = { from: 0, to: 0 };
let results = [];
let totalResults = 0;
let selectedResult = -1;
let resultsRevision = -1;
let searchFailed = false;
let searching = false;
let searchGroups = [];
let searchId = 0;
let searchTimer;
let outlineTimer;
let outlineEntries = [];
let outlineItems = [];
let outlineModel = null;
let activeOutlineItem = null;
let outlineFollowFrame = null;
let sidebarDrag = null;
let sidebarResizeFrame = null;
let recoveryWriter;
const workspaceEnabled = startupState.workspace === true || !desktop;
const multipleWindows = desktop && startupState.multipleWindows === true;
let incomingTransfer = startupState.transfer || null;
let detaching = null;
let draggingFile = false;
let dragCandidate = null;
let suppressWorkspaceClickUntil = 0;
let releaseWindowGate;
let windowGate = incomingTransfer ? new Promise(resolve => { releaseWindowGate = resolve; }) : Promise.resolve();
let recoveryDocumentId = startupDocument.id || crypto.randomUUID().replaceAll('-', '');
selectDocument(recoveryDocumentId);
const workspace = new DocumentWorkspace({
  load: entry => call('loadDocument', { documentId: entry.id }),
  write: (id, snapshot) => call('storeSession', { documentId: id, snapshot }),
  read: id => call('readSession', { documentId: id }),
  beforeActivate: id => workspaceEnabled ? call('activateDocument', { documentId: id }) : Promise.resolve(),
});
for (const info of startupState.documents || []) workspace.add(info);
const initialEntry = workspace.add({ id: recoveryDocumentId, ...documentInfo });
initialEntry.state = { ...createDocumentState(startupDocument), ...startupSession, session: documentSession, savedRevision };
initialEntry.placeholder = startupDocument.placeholder === true;
workspace.activeId = recoveryDocumentId;
let workspaceBusy = false;
let closingWorkspace = false;
let imageImportBusy = false;
let pendingDocumentId = null;
let workspaceListSignature = '';
let workspaceRenderedActiveId = null;
let navigationTab = workspaceEnabled ? 'workspace' : 'outline';
let recoveryState = 'idle';
let codeColorScope = 'default';
let exportController;
let exportImageConfirmation;
let externalSnapshot;
let externalRefreshBusy = false;
let externalRefreshQueued = false;
let externalRetry = 0;
let externalTimer;
let composing = false;
let externalPreviewSnapshot;
let statusTimer;
let saving = false;
let embeddingSave = false;
let scrollSync;
let readingTracker;
let readingRestoreRequest = 0;
let dialogApply;
let toastTimer;
let readOnlyRecovery = null;
let openingHistory = false;
let diagramZoom = 1;
let diagramRequest = 0;
let diagramEdit;
let searchWorker = new Worker(new URL('./search-worker.js', import.meta.url), { type: 'module' });

document.querySelector('#app').innerHTML = `
  <header class="app-header">
    <div class="brand"><img class="brand-logo" src="/inklet.png?v=transparent-20261009" width="44" height="44" alt="Inklet 墨点标志"><span class="brand-copy"><span class="brand-name">Inklet <small>墨点</small></span><span class="brand-tagline">轻快落笔，顺手成文。</span></span></div>
    <div class="file-heading"><span id="file-name"></span><span id="dirty-dot" hidden></span></div>
    <div class="header-actions">
      ${button('file-plus-2', '新建', 'new')}${button('folder-open', '打开文件', 'open')}${button('save', '保存', 'save')}${button('save-all', '另存为', 'save-as')}
      ${button('download', '导出文档', 'print')}
      <span class="tool-separator"></span>${button('search', '查找与替换', 'search')}${button('settings-2', '阅读设置', 'settings')}
      ${button('info', '软件说明', 'about', 'aria-haspopup="dialog" aria-controls="about-dialog"')}
    </div>
  </header>
  <div class="app-body">
    <aside class="sidebar" id="document-sidebar" aria-label="文档导航">
      <div class="sidebar-heading workspace-tabs"><div class="nav-tabs" role="tablist" aria-label="文档导航视图"><button type="button" role="tab" data-tab="workspace">工作空间 <span id="workspace-count">0</span></button><button type="button" role="tab" data-tab="outline">目录</button><button type="button" role="tab" data-tab="marks">标记 <span id="mark-count">0</span></button></div>${button('panel-left-close', '收起文档导航', 'sidebar')}</div>
      <div id="workspace-panel"><div class="workspace-commands">${button('folder-open', '打开多个文件', 'open')}${button('save-all', '保存全部文件', 'save-workspace')}${button('arrow-up-right', '在独立窗口中打开当前文件', 'detach-file', 'id="detach-file-button"')}${button('x', '关闭全部文件', 'close-workspace')}</div><div id="workspace-files" role="list" aria-label="已打开文件"></div></div>
      <button class="current-file" id="active-file-label" data-action="document"><span>${icon('file-text')}</span><span id="sidebar-file"></span></button>
      <nav id="outline" aria-label="文档目录" hidden></nav><div id="marks-list" hidden></div>
      <div class="sidebar-footer"><span class="local-indicator"></span><span>本地文档</span><small>${releaseNotes[0][0]}</small></div>
      <div class="sidebar-resizer" id="sidebar-resizer" role="separator" aria-label="调整文档导航宽度" aria-controls="document-sidebar" aria-orientation="vertical" tabindex="0" title="拖动调整导航宽度，双击恢复默认"></div>
    </aside>
    <main class="main-area">
      <div class="toolbar" role="toolbar" aria-label="编辑工具">
        <div class="toolbar-tools">
          ${button('panel-left-open', '显示或关闭目录', 'sidebar')}${button('undo-2', '撤销', 'undo')}${button('redo-2', '重做', 'redo')}
          <span class="tool-separator"></span>${button('heading-2', '标题', 'heading')}${button('bold', '加粗', 'bold')}${button('italic', '斜体', 'italic')}${button('strikethrough', '删除线', 'strike')}
          <span class="tool-separator"></span>${button('list', '无序列表', 'bullet')}${button('list-ordered', '有序列表', 'ordered')}${button('quote', '引用', 'quote')}${button('link', '插入链接', 'link')}
          <span class="tool-separator"></span>${button('image-plus', '插入图片', 'image')}${button('table-2', '插入表格', 'table')}${button('code-2', '代码块', 'code-block')}${button('sigma', '数学公式', 'math')}${button('workflow', 'Mermaid 图表', 'diagram')}
        </div>
        <div class="view-tools">${button('focus', '专注模式', 'focus')}${button('align-center', '打字机模式', 'typewriter')}<span class="tool-separator"></span>${button('code-2', '源码视图', 'source')}${button('book-open', '阅读编辑视图', 'rich')}</div>
      </div>
      <section class="search-panel" id="search-panel" hidden aria-label="查找与替换">
        <div class="search-line">${icon('search')}<input id="search-input" aria-label="查找内容" placeholder="查找" autocomplete="off"><button id="case-toggle" class="text-toggle" title="区分大小写" aria-label="区分大小写" aria-pressed="false">Aa</button><span id="search-count">0 处</span>${button('chevron-up', '上一个匹配', 'previous')}${button('chevron-down', '下一个匹配', 'next')}${button('x', '关闭查找', 'search-close')}</div>
        <div class="search-line"><input id="replace-input" aria-label="替换内容" placeholder="替换为"><button class="small-command" data-action="replace">替换</button><button class="small-command" data-action="replace-all">全部替换</button><small id="search-time"></small></div>
      </section>
      <div id="external-change" class="external-change" role="status" hidden><span id="external-change-message"></span><div><button type="button" class="small-command" data-action="external-view">查看磁盘版本</button><button type="button" class="small-command" data-action="external-save-as">另存当前版本</button></div></div>
      <div id="image-access" class="external-change" role="status" hidden><span>部分图片无法读取，请确认文件路径及格式。</span><div><button type="button" class="small-command" data-action="retry-images">重新加载</button>${button('x', '关闭图片提示', 'dismiss-images')}</div></div>
      <div class="editor-layout">
      <div class="editor-workspace" id="workspace">
        <section class="editor-pane source-pane" aria-label="源码面板"><div class="pane-heading"><span>MARKDOWN</span><div><span id="line-info">Ln 1, Col 1</span>${button('x', '关闭源码视图', 'source')}</div></div><div id="source-editor"></div></section>
        <div class="splitter" id="splitter" role="separator" aria-label="调整双栏宽度" aria-orientation="vertical" tabindex="0"></div>
        <section class="editor-pane rich-pane" aria-label="阅读面板"><div class="pane-heading"><span>阅读与编辑</span><div>${button('arrow-up-to-line', '回到文首', 'reading-start')}${button('corner-up-left', '回到上次阅读位置', 'reading-return', 'id="reading-return-button" disabled')}</div></div><div id="rich-editor"></div></section>
        <div class="empty-workspace" id="empty-workspace" hidden>${icon('book-open')}<span>视图已关闭</span></div>
      </div>
      <aside id="search-results-panel" class="search-results-panel" aria-label="搜索结果" hidden><div class="search-results-heading"><h2>搜索结果</h2>${button('x', '关闭搜索结果', 'search-results-close')}</div><div id="search-results-summary" class="search-results-summary" role="status"></div><div id="search-results-list" class="search-results-list"></div></aside>
      </div>
      <footer class="status-bar"><span id="save-state"></span><div><span id="word-count"></span><span id="selection-count"></span><span>UTF-8</span><button data-action="zoom-out" aria-label="缩小字体">${icon('zoom-out')}</button><span id="font-size">17</span><button data-action="zoom-in" aria-label="放大字体">${icon('zoom-in')}</button></div></footer>
    </main>
  </div>
  <footer class="copyright-notice"><button type="button" class="history-trigger" data-action="open-history" aria-haspopup="dialog" aria-controls="history-dialog" title="历史记录">${icon('history')}<span>历史记录</span></button></footer>
  <dialog id="history-dialog" class="history-dialog" aria-labelledby="history-title"><form method="dialog"><div class="dialog-heading"><h2 id="history-title">历史记录</h2><button class="icon-button" aria-label="关闭历史记录">${icon('x')}</button></div><div id="history-list" class="history-list"></div><div class="dialog-footer"><span id="history-count" role="status"></span><button class="primary-command">关闭</button></div></form></dialog>
  <dialog id="history-error-dialog" class="history-error-dialog" aria-labelledby="history-error-title"><form method="dialog"><div class="dialog-heading"><h2 id="history-error-title">无法打开文件</h2><button class="icon-button" aria-label="关闭文件提示">${icon('x')}</button></div><div class="history-error-content"><p id="history-error-message"></p><p id="history-error-path"></p></div><div class="dialog-footer"><button class="primary-command">确定</button></div></form></dialog>
  <div class="selection-tools" id="selection-tools" role="toolbar" aria-label="阅读高亮" hidden>${icon('highlighter')}${Object.entries(highlightColors).map(([name, color]) => `<button class="color-swatch" style="--swatch:${color}" data-color="${name}" title="${swatchNames[name]}高亮" aria-label="${swatchNames[name]}高亮"></button>`).join('')}<span class="tool-separator"></span>${button('eraser', '清除高亮', 'clear-highlight')}</div>
  <dialog id="settings-dialog" class="settings-dialog"><form method="dialog"><div class="dialog-heading"><h2>阅读设置</h2><button class="icon-button" aria-label="关闭设置">${icon('x')}</button></div><div class="settings-content">
    <fieldset><legend>客户端主题</legend><label class="select-setting family-setting" for="interface-family-input">色系<select id="interface-family-input">${familyOptions(interfaceFamilies)}</select></label><div class="interface-themes">${Object.entries(interfaceThemes).map(([key, theme]) => `<button type="button" class="interface-theme" data-interface-theme="${key}" aria-pressed="false"><span style="background:linear-gradient(135deg,${theme.base},${theme.secondary})"></span>${theme.name}</button>`).join('')}</div></fieldset>
    <label class="select-setting" for="outline-side-input">大纲位置<select id="outline-side-input"><option value="left">左侧</option><option value="right">右侧</option></select></label>
    <button type="button" class="small-command shortcut-settings-button" data-action="shortcuts">自定义快捷键</button>
    <fieldset><legend>源码背景</legend><label class="select-setting family-setting" for="source-family-input">色系<select id="source-family-input" data-paper-family="leftTheme">${familyOptions(paperFamilies)}</select></label><div class="theme-options">${backgroundOptions('leftTheme')}</div></fieldset>
    <fieldset><legend>阅读背景</legend><label class="select-setting family-setting" for="reader-family-input">色系<select id="reader-family-input" data-paper-family="rightTheme">${familyOptions(paperFamilies)}</select></label><div class="theme-options">${backgroundOptions('rightTheme')}</div></fieldset>
    <button type="button" class="small-command" data-action="unify-theme">统一两栏背景</button>
    <label class="checkbox-setting"><input id="paper-input" type="checkbox">纸张纹理</label>
    <label class="select-setting" for="reading-font-input">正文字体<select id="reading-font-input"><option value="book">书卷宋体</option><option value="sans">清晰黑体</option><option value="kai">楷书风格</option></select></label>
    <label class="range-setting">正文字号 <output id="font-output">17 px</output><input id="font-input" type="range" min="14" max="24" step="1"></label>
    <label class="range-setting">行距 <output id="line-height-output">2.05 倍</output><input id="line-height-input" type="range" min="1.6" max="2.6" step="0.05"></label>
    <label class="range-setting">段间距 <output id="paragraph-gap-output">1.0 倍</output><input id="paragraph-gap-input" type="range" min="0.5" max="1.6" step="0.1"></label>
    <label class="range-setting">阅读宽度 <output id="reading-width-output">720 px</output><input id="reading-width-input" type="range" min="520" max="960" step="40"></label>
    <label class="range-setting">高亮不透明度 <output id="opacity-output">30%</output><input id="opacity-input" type="range" min="15" max="50" step="5"></label>
    <label class="checkbox-setting"><input id="sync-input" type="checkbox">两栏同步滚动</label>
    <label class="checkbox-setting"><input id="restore-reading-input" type="checkbox">打开时恢复阅读位置</label>
    <label class="checkbox-setting"><input id="search-results-input" type="checkbox">显示搜索结果侧栏</label>
    <label class="checkbox-setting"><input id="ctrl-wheel-input" type="checkbox">Ctrl + 滚轮调整字号</label>
    <label class="checkbox-setting" id="separate-windows-setting"><input id="separate-windows-input" type="checkbox">打开 MD 时使用独立窗口</label>
    <label class="checkbox-setting"><input id="compress-input" type="checkbox">插入图片时压缩至最长边 1920 px</label>
    <label class="checkbox-setting"><input id="embed-images-input" type="checkbox">保存时内嵌图片到 MD</label>
    <fieldset class="code-colors-settings"><legend>代码配色</legend><label class="select-setting" for="code-color-language">编程语言<select id="code-color-language"><option value="default">所有语言</option>${codeLanguages.filter(([value]) => value !== 'plaintext').map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><div class="code-colors-grid">${Object.entries(codeColorLabels).map(([key, label]) => `<label>${label}<input type="color" data-code-color="${key}" aria-label="${label}颜色" value="${codeColorDefaults[key]}"></label>`).join('')}</div><button type="button" class="small-command" data-action="code-colors-reset">恢复代码默认配色</button></fieldset>
    <div class="system-settings" ${desktop ? '' : 'hidden'}><button type="button" class="small-command" data-action="default-app">${icon('arrow-up-right')} Markdown 默认打开方式</button></div>
  </div><div class="dialog-footer"><button class="primary-command">完成</button></div></form></dialog>
  <dialog id="embed-warning-dialog" class="history-error-dialog" aria-labelledby="embed-warning-title"><form method="dialog"><div class="dialog-heading"><h2 id="embed-warning-title">开启图片内嵌保存</h2><button class="icon-button" value="cancel" aria-label="取消开启">${icon('x')}</button></div><div class="history-error-content"><p>开启后，保存或另存为会把本地图片写进 MD。建议先另存副本，保留原始引用。</p><p>Base64数据通常比原图片增加约三分之一体积，源码更长，部分Markdown软件和GitHub页面可能不显示。SVG及BMP会转成PNG，SVG不再保留矢量缩放特性。</p><p>明确占位引用会保留原文。缺图、无法转换或图片内嵌超限时，会提示并由你选择保留引用后保存；文档本身超限或写入失败仍会停止。关闭开关不会还原已内嵌的图片；含图片的段落可能规范化Markdown写法。</p></div><div class="dialog-footer"><button class="small-command" value="cancel">取消</button><button class="primary-command" value="enable">了解并开启</button></div></form></dialog>
  <dialog id="save-images-dialog" class="history-error-dialog" aria-labelledby="save-images-title"><form method="dialog"><div class="dialog-heading"><h2 id="save-images-title">部分图片未能内嵌</h2><button class="icon-button" value="cancel" aria-label="取消保存">${icon('x')}</button></div><div class="history-error-content"><p>继续保存会保留以下图片的原引用，正文不会丢弃；其他可读取的图片仍会内嵌。移走原图片后，这些引用可能无法显示。</p><ul id="save-image-issues"></ul></div><div class="dialog-footer"><button class="small-command" value="cancel">返回检查</button><button class="primary-command" value="save">保留原引用并保存</button></div></form></dialog>
  <dialog id="shortcuts-dialog" class="shortcuts-dialog" aria-labelledby="shortcuts-title"><form method="dialog"><div class="dialog-heading"><h2 id="shortcuts-title">自定义快捷键</h2><button class="icon-button" aria-label="关闭快捷键设置">${icon('x')}</button></div><div class="shortcuts-content" id="shortcuts-list"></div><p id="shortcut-error" role="alert"></p><div class="dialog-footer"><button type="button" class="small-command" data-action="shortcuts-reset">恢复默认</button><button type="button" class="primary-command" data-action="shortcuts-save">保存快捷键</button></div></form></dialog>
  <dialog id="export-dialog" class="export-dialog" aria-labelledby="export-title"><form id="export-form"><div class="dialog-heading"><h2 id="export-title">导出文档</h2><button type="button" class="icon-button" data-action="export-close" aria-label="关闭导出">${icon('x')}</button></div><div class="export-content"><label class="select-setting" for="export-format">文件格式<select id="export-format"><option value="pdf">PDF</option><option value="html">HTML</option><option value="docx">Word (.docx)</option></select></label><p id="export-status" role="status"></p></div><div class="dialog-footer"><button type="button" class="small-command" data-action="export-close">取消</button><button type="submit" class="primary-command" id="export-submit">导出</button></div></form></dialog>
  <dialog id="about-dialog" class="about-dialog" aria-labelledby="about-title"><form method="dialog">
    <div class="dialog-heading"><h2 id="about-title">软件说明</h2><button class="icon-button" aria-label="关闭软件说明">${icon('x')}</button></div>
    <div class="about-content">
      <div class="about-product"><img src="/inklet.png?v=transparent-20261009" width="64" height="64" alt=""><div><strong>Inklet 墨点</strong><span>${releaseNotes[0][0]}</span></div></div>
      <dl class="about-details">
        <div><dt>软件编写作者</dt><dd>达芬奇Vincent</dd></div>
        <div><dt>联系方式</dt><dd><span>微信号</span> <code class="contact-id">seveniear_7</code></dd></div>
      </dl>
      <section class="about-updates" aria-labelledby="about-updates-title"><h3 id="about-updates-title">版本更新</h3><div class="release-notes" tabindex="0" role="region" aria-label="版本更新记录"><table class="release-table"><thead><tr><th scope="col">版本</th><th scope="col">更新内容</th><th scope="col">日期</th></tr></thead><tbody>${releaseNotes.map(([version, summary, date]) => `<tr><td class="release-version">${version}</td><td class="release-summary">${summary}</td><td class="release-date">${date ? `<time datetime="${date}">${date}</time>` : '未记录'}</td></tr>`).join('')}</tbody></table></div></section>
    </div>
    <div class="dialog-footer"><button class="primary-command">关闭</button></div>
  </form></dialog>
  <dialog id="edit-dialog" class="edit-dialog"><form id="edit-form"><div class="dialog-heading"><h2 id="edit-title"></h2><button type="button" data-action="edit-close" class="icon-button" aria-label="关闭编辑">${icon('x')}</button></div><div class="edit-content" id="edit-content"></div><div class="dialog-footer"><button type="button" class="small-command" data-action="edit-close">取消</button><button type="submit" class="primary-command">确定</button></div></form></dialog>
  <dialog id="external-dialog" class="external-dialog" aria-labelledby="external-title"><form method="dialog"><div class="dialog-heading"><h2 id="external-title">磁盘版本</h2><button class="icon-button" aria-label="关闭磁盘版本">${icon('x')}</button></div><div class="external-preview-content"><textarea id="external-preview" aria-label="磁盘文件内容" readonly spellcheck="false"></textarea></div><div class="dialog-footer"><button class="small-command">保留当前</button><button type="button" class="primary-command" data-action="external-adopt">采用磁盘版本</button></div></form></dialog>
  <dialog id="image-dialog" class="image-dialog"><div class="dialog-heading"><h2 id="image-title">图片</h2><button class="icon-button" data-action="image-close" aria-label="关闭图片">${icon('x')}</button></div><img id="image-preview" alt="图片预览"></dialog>
  <dialog id="diagram-dialog" class="diagram-dialog" aria-labelledby="diagram-title"><div class="dialog-heading"><h2 id="diagram-title">图表</h2><div class="diagram-view-controls">${button('zoom-out', '缩小图表', 'diagram-zoom-out')}<output id="diagram-zoom">100%</output>${button('zoom-in', '放大图表', 'diagram-zoom-in')}${button('maximize', '适应宽度', 'diagram-fit')}<span class="tool-separator"></span>${button('code-2', '编辑图表源码', 'diagram-source')}${button('x', '关闭图表', 'diagram-close')}</div></div><div id="diagram-viewport" class="diagram-viewport" tabindex="0" aria-label="图表浏览区"><div id="diagram-stage"></div></div></dialog>
  <div class="table-tools" id="table-tools" hidden aria-label="表格操作">${button('rows-3', '下方插入行', 'row-add')}${button('columns-2', '右侧插入列', 'column-add')}${button('trash-2', '删除当前行', 'row-delete')}${button('x', '删除当前列', 'column-delete')}</div>
  <input type="file" id="image-input" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" multiple hidden>
  <div id="toast" role="status" hidden></div>
`;
createIcons({ icons: iconSet, attrs: { 'stroke-width': 1.7 } });
const find = selector => document.querySelector(selector);
const matchesForSource = () => results;
const matchesForRich = () => selectedResult >= 250 ? [...results.slice(0, 250), results[selectedResult]] : results.slice(0, 250);
const common = {
  source: documentSession.source, marks: () => documentSession.highlights,
  codeColors: () => settings.codeColors || {},
  undo: () => history('undo'), redo: () => history('redo'), save: () => save(), search: () => toggleSearch(true),
  focus: pane => { activePane = pane; }, selection: setSelection, typewriter: () => settings.typewriter,
  paste: event => pasteImages(event), drop: event => dropFiles(event), scroll: pane => synchronizeScroll(pane),
};
const sourceEditor = new SourceEditor(find('#source-editor'), { ...common, matches: matchesForSource, change: changes => {
  for (const change of [...changes].reverse()) changeDocument(change, 'source');
}, codeColors: () => paneCodeColors(settings.leftTheme, settings.codeColors), dark: () => themes[settings.leftTheme]?.family === 'dark' });
const richEditor = new RichEditor(find('#rich-editor'), { ...common, matches: matchesForRich, sourceText: () => documentSession.source,
  codeColors: () => paneCodeColors(settings.rightTheme, settings.codeColors),
  diagramTheme: () => themes[settings.rightTheme]?.family === 'dark' ? 'dark' : 'neutral',
  parsed: updateWordCount,
  navigate: reveal,
  diagram: (code, edit) => openDiagramPreview(code, edit).catch(showError),
  change: change => changeDocument(change, 'rich'), edit: openCodeDialog, asset: assetUrl,
  image: (path, alt) => { find('#image-preview').src = assetUrl(path); find('#image-title').textContent = alt || '图片'; find('#image-dialog').showModal(); },
  imageError: (path, image) => { if (desktop && image.isConnected && !/^(?:https?:|data:|\/\/)/i.test(path)) find('#image-access').hidden = false; },
  imageLoaded: () => { if (!find('#rich-editor .image-missing')) find('#image-access').hidden = true; },
  link: url => { if (/^https?:\/\//i.test(url)) call('external', { url }).catch(showError); },
});
scrollSync = new ScrollSynchronizer({ source: sourceEditor, rich: richEditor, enabled: () => settings.syncScroll && settings.source && settings.rich, visible: pane => pane === 'source' ? settings.source : settings.rich });
readingTracker = new ReadingPositionTracker({
  current: () => ({ id: recoveryDocumentId, path: documentInfo.path }),
  read: id => desktop ? call('readReadingPosition', { documentId: id }) : Promise.resolve(null),
  write: (id, position) => desktop ? call('saveReadingPosition', { documentId: id, position }) : Promise.resolve(),
  capture: captureReadingPosition,
  available: point => { find('#reading-return-button').disabled = !point; find('#reading-return-button').title = point ? '回到上次阅读位置' : '暂无阅读记录'; },
  onError: () => toast('阅读位置记录暂不可用，文档保存不受影响。', true),
});
for (const element of [sourceEditor.view.scrollDOM, richEditor.container]) {
  for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) element.addEventListener(type, () => {
    readingRestoreRequest++; readingTracker.suspended = false; readingTracker.intent();
  }, { passive: true });
}
function captureReadingPosition() {
  const pane = settings.rich ? 'rich' : settings.source ? 'source' : null;
  if (!pane || !documentInfo.path) return null;
  const anchor = scrollSync.capture(pane);
  if (!anchor) return null;
  const position = anchor.edge === 'end' ? documentSession.source.length : anchor.edge === 'start' ? 0 : anchor.text ?? anchor.from ?? 0;
  const headings = outlineOf(richEditor.parsed);
  const heading = headings.findLast(item => item.from <= position);
  const occurrence = heading ? headings.filter(item => item.from < heading.from && item.text === heading.text && item.level === heading.level).length : 0;
  return { Hash: dirty() ? null : documentInfo.hash, SourcePosition: position, Heading: heading?.text.slice(0, 512) || '', HeadingLevel: heading?.level || 0, HeadingOccurrence: occurrence, BlockProgress: anchor.progress || 0, HasTextAnchor: Number.isInteger(anchor.text), TextProgress: anchor.lineProgress || 0, ActivePane: pane, FallbackScrollTop: scrollSync.container(pane).scrollTop };
}
async function moveToReadingPosition(point) {
  const request = ++readingRestoreRequest; const id = recoveryDocumentId;
  readingTracker.suspend(); scrollSync.reset();
  try {
    await document.fonts.ready;
    if (request !== readingRestoreRequest || id !== recoveryDocumentId) return;
    richEditor.flush();
    const anchor = resolveReadingPosition(point, { hash: dirty() ? null : documentInfo.hash, sourceLength: documentSession.source.length, headings: outlineOf(richEditor.parsed), ranges: richEditor.parsed.ranges });
    const range = !anchor.edge && richEditor.parsed.ranges.find(item => item.from === anchor.from);
    if (range) richEditor.tables.ensure(range.position + 1);
    for (let frame = 0; frame < 8; frame++) {
      if (request !== readingRestoreRequest || id !== recoveryDocumentId) return;
      scrollSync.apply('source', anchor); scrollSync.apply('rich', anchor);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    scheduleOutlineFollow();
  } finally { if (request === readingRestoreRequest) readingTracker.suspended = false; }
}
async function initializeReadingPosition(restore = true) {
  const id = recoveryDocumentId;
  const first = await readingTracker.open();
  if (id === recoveryDocumentId && first && restore && settings.restoreReadingPosition && !dirty() && readingTracker.previous) await moveToReadingPosition(readingTracker.previous);
}
const navigationResizeObserver = new ResizeObserver(scheduleOutlineFollow);
navigationResizeObserver.observe(richEditor.view.dom);
navigationResizeObserver.observe(richEditor.container);
richEditor.container.addEventListener('contentvisibilityautostatechange', scheduleOutlineFollow, true);
function createRecoveryWriter() { return new RecoveryWriter({
  snapshot: () => !incomingTransfer && (!detaching || detaching.preparing) && dirty() ? { documentId: recoveryDocumentId, revision: documentSession.revision, text: documentSession.source, name: documentInfo.name, path: documentInfo.path, hash: documentInfo.hash, annotations: annotationPayload() } : null,
  write: call,
  onState: state => { recoveryState = state; updateStatus(); },
  onError: () => toast('恢复副本写入失败，请立即另存文档。', true),
}); }
if (desktop) recoveryWriter = createRecoveryWriter();

const workspaceCloseDialog = document.createElement('dialog');
workspaceCloseDialog.id = 'workspace-close-dialog';
workspaceCloseDialog.setAttribute('aria-labelledby', 'workspace-close-title');
workspaceCloseDialog.innerHTML = `<div class="dialog-heading"><h2 id="workspace-close-title">关闭前处理未保存文件</h2>${button('x', '取消关闭', 'cancel-workspace-close')}</div><div id="workspace-close-list"></div><div class="dialog-footer workspace-close-actions"><button type="button" class="primary-command" data-close-choice="save">全部保存</button><button type="button" class="small-command" data-close-choice="selected">按所选处理</button><button type="button" class="small-command" data-close-choice="discard">全部放弃</button><button type="button" class="small-command" data-close-choice="cancel">取消</button></div>`;
document.querySelector('#app').append(workspaceCloseDialog);
createIcons({ icons: iconSet });

function captureDocumentState() {
  const entry = workspace.active;
  if (!entry?.state) return;
  entry.state.session = documentSession;
  entry.state.info = { ...documentInfo };
  entry.state.savedRevision = savedRevision;
  entry.state.selection = { ...selection };
  entry.state.view = { sourceTop: sourceEditor.view.scrollDOM.scrollTop, richTop: find('#rich-editor').scrollTop, activePane };
  entry.state.search = { query: find('#search-input').value, replacement: find('#replace-input')?.value || '' };
  entry.dirty = dirty();
  entry.info = { ...entry.info, ...documentInfo };
  if (entry.dirty || documentInfo.path) entry.placeholder = false;
}

function workspaceEntries() { return [...workspace.entries.values()].filter(entry => !entry.placeholder); }

function renderWorkspace() {
  workspaceRenderedActiveId = recoveryDocumentId;
  const entries = workspaceEntries();
  const signature = entries.map(entry => [entry.id, entry.info.name, entry.info.path, entry.id === recoveryDocumentId, entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty, entry.changedExternally].join('|')).join('\n');
  find('#workspace-count').textContent = entries.length;
  if (signature === workspaceListSignature && find('#workspace-files').childElementCount) return;
  workspaceListSignature = signature;
  const list = find('#workspace-files'); list.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('div'); row.className = 'workspace-file'; row.dataset.documentId = entry.id; row.setAttribute('role', 'listitem');
    row.classList.toggle('active', entry.id === recoveryDocumentId);
    const open = document.createElement('button'); open.type = 'button'; open.className = 'workspace-file-open'; open.title = entry.info.path || entry.info.name;
    open.dataset.documentOpen = entry.id;
    if (entry.id === recoveryDocumentId) open.setAttribute('aria-current', 'page');
    const image = document.createElement('span'); image.innerHTML = icon('file-text');
    const label = document.createElement('span'); label.className = 'workspace-file-name'; label.textContent = entry.info.name;
    const indicator = document.createElement('span'); indicator.className = 'workspace-dirty'; indicator.hidden = !(entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty); indicator.title = '未保存'; indicator.setAttribute('aria-label', '未保存');
    if (entry.changedExternally) row.classList.add('external-pending');
    open.append(image, label, indicator);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'icon-button workspace-file-close'; close.dataset.documentClose = entry.id; close.title = '关闭 ' + entry.info.name; close.setAttribute('aria-label', close.title); close.innerHTML = icon('x');
    row.append(open, close); list.append(row);
  }
  if (!entries.length) { const empty = document.createElement('p'); empty.className = 'workspace-empty'; empty.textContent = '暂无打开文件'; list.append(empty); }
  createIcons({ icons: iconSet });
}

function setNavigationTab(tab) {
  navigationTab = tab;
  for (const button of document.querySelectorAll('[data-tab]')) { const selected = button.dataset.tab === tab; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); }
  find('#workspace-panel').hidden = tab !== 'workspace';
  find('#active-file-label').hidden = tab === 'workspace';
  find('#outline').hidden = tab !== 'outline';
  find('#marks-list').hidden = tab !== 'marks';
  if (tab === 'workspace') renderWorkspace(); else updateNavigation();
}

async function switchDocument(id, internal = false) {
  if (incomingTransfer || (!internal && (detaching || draggingFile))) return false;
  if (id === recoveryDocumentId) return true;
  if (composing || workspaceBusy || saving || externalRefreshBusy || imageImportBusy) { pendingDocumentId = id; return false; }
  if ((!internal && closingWorkspace) || exportController || document.querySelector('dialog[open]')) { toast('请先完成当前操作，再切换文件。'); return false; }
  workspaceBusy = true;
  find('#workspace').inert = true;
  find('#workspace').setAttribute('aria-busy', 'true');
  try {
    richEditor.flush();
    await readingTracker.flush().catch(() => {});
    captureDocumentState();
    document.activeElement?.blur();
    if (!workspace.active?.pinned) await recoveryWriter?.flush();
    clearTimeout(searchTimer); clearTimeout(outlineTimer); clearTimeout(externalTimer); clearTimeout(window.selectionTimer); clearTimeout(statusTimer);
    scrollSync.reset();
    const previous = workspace.active;
    if (previous && documentSession.source.length <= 128 * 1024) previous.rendered = richEditor.parsed;
    recoveryWriter?.reset();
    const entry = await workspace.activate(id);
    const hasReadingView = !!entry.state.view;
    recoveryDocumentId = id;
    selectDocument(id);
    documentSession = entry.state.session; documentInfo = entry.state.info; savedRevision = entry.state.savedRevision;
    selection = { ...entry.state.selection }; activePane = entry.state.view?.activePane || 'rich';
    externalSnapshot = null; externalPreviewSnapshot = null; externalRetry = 0; externalRefreshQueued = false;
    find('#external-change').hidden = true;
    find('#image-access').hidden = true;
    richEditor.pending = undefined;
    results = []; totalResults = 0; selectedResult = -1; resultsRevision = -1; searchId++; searchGroups = [];
    sourceEditor.setText(documentSession.source);
    richEditor.load(documentSession.source, entry.rendered);
    for (const candidate of workspace.entries.values()) if (!candidate.state || candidate.id === id) candidate.rendered = null;
    const cached = [...workspace.entries.values()].filter(candidate => candidate.rendered).sort((first, second) => second.used - first.used);
    for (const candidate of cached.slice(1)) candidate.rendered = null;
    find('#search-input').value = entry.state.search?.query || '';
    if (find('#replace-input')) find('#replace-input').value = entry.state.search?.replacement || '';
    searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
    sourceEditor.view.dispatch({ selection: { anchor: Math.min(selection.from, documentSession.source.length), head: Math.min(selection.to, documentSession.source.length) } });
    richEditor.reveal(selection.from, selection.to, true, false);
    const view = entry.state.view;
    sourceEditor.view.scrollDOM.scrollTop = view?.sourceTop || 0;
    find('#rich-editor').scrollTop = view?.richTop || 0;
    requestAnimationFrame(() => {
      if (recoveryDocumentId !== id) return;
      sourceEditor.view.scrollDOM.scrollTop = view?.sourceTop || 0;
      find('#rich-editor').scrollTop = view?.richTop || 0;
      scrollSync.refresh();
    });
    find('#selection-tools').hidden = true; find('#table-tools').hidden = true;
    updateStatus(); updateNavigation(); renderWorkspace(); invalidateSearch();
    if (!find('#search-panel').hidden) scheduleSearch();
    if (dirty()) recoveryWriter?.schedule();
    if (desktop && documentInfo.path) queueExternalRefresh();
    if (desktop && workspaceEnabled && previous) await call('releaseDocument', { documentId: previous.id });
    await initializeReadingPosition(!hasReadingView);
    return true;
  } catch (error) { showError(error); return false; }
  finally {
    workspaceBusy = false; find('#workspace').inert = closingWorkspace; find('#workspace').removeAttribute('aria-busy');
    resumeDocumentSwitch();
  }
}

function resumeDocumentSwitch() {
  if (!pendingDocumentId || incomingTransfer || detaching || draggingFile || workspaceBusy || composing || saving || externalRefreshBusy || imageImportBusy || closingWorkspace) return;
  const id = pendingDocumentId; pendingDocumentId = null;
  if (workspace.entries.has(id)) queueMicrotask(() => switchDocument(id));
}

function releaseTransfer(message) {
  detaching = null;
  find('#app').inert = !!incomingTransfer;
  delete find('#app').dataset.windowTransfer;
  releaseWindowGate?.(); releaseWindowGate = null; windowGate = Promise.resolve();
  updateStatus(); renderWorkspace();
  if (dirty()) recoveryWriter?.schedule();
  if (message) toast(message, true);
  resumeDocumentSwitch();
}

async function detachDocument(id = recoveryDocumentId, dropPoint = null) {
  if (!multipleWindows || incomingTransfer || detaching || draggingFile || workspaceBusy || closingWorkspace || saving || composing || imageImportBusy || externalRefreshBusy || exportController || document.querySelector('dialog[open]')) return false;
  if (!workspace.entries.has(id) || !await switchDocument(id)) return false;
  const token = crypto.randomUUID().replaceAll('-', '');
  detaching = { token, id, preparing: true };
  windowGate = new Promise(resolve => { releaseWindowGate = resolve; });
  find('#app').inert = true;
  find('#app').dataset.windowTransfer = 'preparing';
  try {
    richEditor.flush(); captureDocumentState();
    await recoveryWriter?.flush();
    detaching.preparing = false;
    clearTimeout(statusTimer); clearTimeout(externalTimer); clearTimeout(searchTimer);
    recoveryWriter?.reset();
    const snapshot = workspace.snapshot(workspace.active);
    await call('detachDocument', { documentId: id, token, snapshot, dropPoint });
    return true;
  } catch (error) {
    await call('cancelDetach').catch(() => {});
    if (detaching?.token === token) releaseTransfer(error.message);
    return false;
  }
}

async function finishDetach(token) {
  if (!detaching || detaching.token !== token || detaching.committing) return;
  detaching.committing = true;
  let moved = false;
  try {
    const result = await call('commitDetach', { token });
    if (!result?.moved || result.documentId !== detaching.id) throw new Error('新窗口尚未接收文档，原文档已保留。');
    moved = true;
    clearTimeout(statusTimer); recoveryWriter?.reset();
    workspace.remove(detaching.id);
    let next = [...workspace.entries.values()].at(-1);
    if (!next) {
      const blank = await call('new', { placeholder: true });
      next = workspace.add(blank, createDocumentState(blank)); next.placeholder = true;
    }
    if (!await switchDocument(next.id, true)) throw new Error('文档已移到新窗口，原窗口切换未完成。');
    releaseTransfer();
  } catch (error) {
    if (!moved) await call('cancelDetach').catch(() => {});
    else {
      recoveryDocumentId = null; selectDocument(null); documentSession = new DocumentSession(); savedRevision = 0;
      documentInfo = { name: '未命名.md', path: null, hash: null };
      sourceEditor.setText(''); richEditor.load(''); updateNavigation();
    }
    releaseTransfer(error.message);
  }
}

async function addOpenedDocuments(data, restored = false) {
  if (!data) return false;
  const records = data.documents || [data];
  let selected;
  for (const record of records) {
    const id = record.id || crypto.randomUUID().replaceAll('-', '');
    const entry = workspace.add({ ...record, id }, typeof record.text === 'string' ? createDocumentState(record, restored || record.restored === true) : null);
    entry.placeholder = record.placeholder === true;
    selected = entry;
  }
  if (!selected) { if (data.warnings?.length) toast(data.warnings.join('\n'), true); return false; }
  const placeholder = workspace.active?.placeholder && !dirty() ? workspace.active : null;
  const switched = await switchDocument(selected.id, closingWorkspace);
  if (switched && placeholder && placeholder.id !== selected.id) {
    await call('closeDocuments', { ids: [placeholder.id], discard: false });
    workspace.remove(placeholder.id);
  }
  if (data.warnings?.length) toast(data.warnings.join('\n'), true);
  setNavigationTab('workspace');
  return switched;
}

function chooseClosingDocuments(entries) {
  return new Promise(resolve => {
    const list = find('#workspace-close-list'); list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement('label'); row.className = 'workspace-close-row';
      const name = document.createElement('span'); name.textContent = entry.info.name; name.title = entry.info.path || entry.info.name;
      const select = document.createElement('select'); select.dataset.closeDocument = entry.id; select.setAttribute('aria-label', entry.info.name + ' 的关闭处理');
      select.innerHTML = '<option value="save">保存</option><option value="discard">放弃修改</option>';
      row.append(name, select); list.append(row);
    }
    let result = null;
    workspaceCloseDialog.onclick = event => {
      const choice = event.target.closest('[data-close-choice]')?.dataset.closeChoice;
      if (!choice) return;
      if (choice !== 'cancel') result = new Map(entries.map(entry => [entry.id, choice === 'selected' ? list.querySelector(`[data-close-document="${entry.id}"]`).value : choice]));
      workspaceCloseDialog.close();
    };
    workspaceCloseDialog.addEventListener('close', () => { workspaceCloseDialog.onclick = null; resolve(result); }, { once: true });
    workspaceCloseDialog.showModal();
  });
}

async function saveWorkspace() {
  if (workspaceBusy || saving || closingWorkspace || composing) return;
  richEditor.flush(); captureDocumentState();
  const original = recoveryDocumentId;
  for (const entry of workspaceEntries().filter(entry => entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty)) {
    if (!await switchDocument(entry.id) || !await save()) return;
  }
  await switchDocument(original);
}

async function closeDocuments(ids, exit = false) {
  if (incomingTransfer || detaching || draggingFile || workspaceBusy || saving || externalRefreshBusy || imageImportBusy || composing || closingWorkspace || document.querySelector('dialog[open]')) {
    if (exit) await call('cancelClose');
    toast('请先完成当前操作，再关闭文件。');
    return false;
  }
  richEditor.flush(); captureDocumentState();
  closingWorkspace = true; find('#workspace').inert = true; document.activeElement?.blur();
  try {
    await readingTracker.flush().catch(() => {});
    const entries = ids.map(id => workspace.entries.get(id)).filter(Boolean);
    const modified = entries.filter(entry => entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty);
    const choices = modified.length ? await chooseClosingDocuments(modified) : new Map();
    if (!choices) return false;
    for (const entry of modified) entry.pinned = choices.get(entry.id) === 'discard';
    for (const entry of modified) if (choices.get(entry.id) === 'save') {
      if (!await switchDocument(entry.id, true) || !await save()) return false;
    }
    const remaining = [...workspace.entries.values()].filter(entry => !ids.includes(entry.id));
    if (ids.includes(recoveryDocumentId) && !exit) {
      if (remaining.length) { if (!await switchDocument(remaining[remaining.length - 1].id, true)) return false; }
      else { if (!await addOpenedDocuments(await call('new', { placeholder: true }))) return false; }
    }
    if (exit) { await recoveryWriter?.flush().catch(() => {}); recoveryWriter?.reset(); }
    await call('closeDocuments', { ids, discard: modified.length > 0 });
    for (const id of ids) workspace.remove(id);
    readingTracker.forget(ids);
    renderWorkspace();
    if (exit) await call('finishClose');
    return true;
  } catch (error) { showError(error); return false; }
  finally {
    for (const entry of workspace.entries.values()) entry.pinned = false;
    closingWorkspace = false; find('#workspace').inert = false;
    if (exit) await call('cancelClose').catch(() => {});
    resumeDocumentSwitch();
  }
}

function showError(error) { if (error?.name !== 'AbortError') toast(error.message || String(error), true); }
function toast(message, error = false) {
  const element = find('#toast');
  element.textContent = message;
  element.classList.toggle('error', error);
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, error ? 7000 : 3000);
}
function dirty() { return savedRevision !== documentSession.revision; }
function annotationPayload() { return { version: 1, marks: [...serializeHighlights(documentSession.source, documentSession.highlights), ...documentSession.unresolved] }; }
function updateWordCount(doc) {
  const counts = wordStatistics(doc);
  find('#word-count').textContent = counts.total.toLocaleString() + ' 字';
  find('#word-count').title = `汉字 ${counts.han.toLocaleString()} · 字母 ${counts.letters.toLocaleString()} · 数字 ${counts.numbers.toLocaleString()}`;
}
function updateStatus() {
  find('#file-name').textContent = documentInfo.name;
  find('#sidebar-file').textContent = documentInfo.name;
  find('#dirty-dot').hidden = !dirty();
  const recoveryLabels = { pending: '正在保护输入...', writing: '正在写入恢复日志...', protected: '恢复副本已落盘', error: '恢复保护失败' };
  find('#save-state').textContent = saving ? '正在保存...' : dirty() ? '未保存' + (desktop ? ' · ' + (recoveryLabels[recoveryState] || '等待恢复保护') : '') : documentInfo.path ? '已保存到本地' : '本地草稿';
  find('#save-state').dataset.recovery = recoveryState;
  find('#selection-count').textContent = selection.to > selection.from ? '选中 ' + (selection.to - selection.from) : '';
  const line = sourceEditor.view.state.doc.lineAt(Math.min(selection.from, sourceEditor.view.state.doc.length));
  find('#line-info').textContent = `Ln ${line.number}, Col ${Math.max(1, selection.from - line.from + 1)}`;
  find('[data-action="undo"]').disabled = !documentSession.past.length;
  find('[data-action="redo"]').disabled = !documentSession.future.length;
  document.title = (dirty() ? '* ' : '') + documentInfo.name + ' - Inklet 墨点';
  clearTimeout(statusTimer);
  if (workspace.active?.state) {
    const entry = workspace.active;
    const modified = dirty();
    const labelChanged = entry.info.name !== documentInfo.name || entry.info.path !== documentInfo.path;
    const placeholderChanged = entry.placeholder && (modified || documentInfo.path);
    const listChanged = labelChanged || placeholderChanged || entry.dirty !== modified || workspaceRenderedActiveId !== recoveryDocumentId;
    entry.state.session = documentSession; entry.state.savedRevision = savedRevision; entry.state.info = documentInfo;
    if (labelChanged) entry.info = { ...entry.info, ...documentInfo };
    entry.dirty = modified;
    if (placeholderChanged) entry.placeholder = false;
    if (listChanged) renderWorkspace();
  }
  const state = { documentId: recoveryDocumentId, dirty: dirty(), name: documentInfo.name, characters: documentSession.source.length };
  if (!incomingTransfer && !detaching) statusTimer = setTimeout(() => call('state', state).catch(() => {}), 50);
}
function changed() {
  updateStatus();
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(updateNavigation, 180);
  if (!find('#search-panel').hidden && find('#search-input').value) scheduleSearch();
  recoveryWriter?.schedule();
}
function changeDocument(change, origin) {
  if (!documentSession.replace(change)) return;
  searchWorker.postMessage({ type: 'change', change, revision: documentSession.revision });
  if (origin !== 'source') sourceEditor.replace(change);
  if (origin !== 'rich') richEditor.schedule(documentSession.source);
  changed();
}
function history(action) {
  richEditor.flush();
  const before = documentSession.source;
  if (!documentSession[action]()) return false;
  if (before !== documentSession.source) sourceEditor.replace(minimalChange(before, documentSession.source));
  richEditor.load(documentSession.source);
  sourceEditor.refresh();
  searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
  changed();
  return true;
}
function setSelection(from, to) {
  selection = { from: Math.max(0, Math.min(from, to)), to: Math.min(documentSession.source.length, Math.max(from, to)) };
  updateStatus();
  clearTimeout(window.selectionTimer);
  window.selectionTimer = setTimeout(() => {
    const toolbar = find('#selection-tools');
    if (selection.from >= selection.to || find('dialog[open]') || document.activeElement?.closest('.search-panel')) { toolbar.hidden = true; return; }
    try {
      const anchor = activePane === 'source' ? sourceEditor.anchor : richEditor.anchor;
      toolbar.hidden = false;
      const width = toolbar.offsetWidth;
      toolbar.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left - 30)) + 'px';
      toolbar.style.top = Math.max(72, anchor.top - 52) + 'px';
    } catch { toolbar.hidden = true; }
  }, 130);
  const table = document.getSelection()?.anchorNode?.parentElement?.closest('table');
  find('#table-tools').hidden = !(activePane === 'rich' && table);
}
function paint(color) {
  if (!documentSession.paint(selection.from, selection.to, color, settings.opacity)) return;
  sourceEditor.refresh(); richEditor.refresh(); changed();
  find('#selection-tools').hidden = true;
}
function updateNavigation() {
  const outline = find('#outline');
  outline.replaceChildren();
  const headings = outlineOf(richEditor.parsed);
  outlineEntries = headings;
  outlineItems = [];
  outlineModel = richEditor.parsed;
  activeOutlineItem = null;
  for (const [index, heading] of headings.entries()) {
    const item = document.createElement('button');
    item.textContent = heading.text || '未命名标题';
    item.className = 'outline-item';
    item.dataset.outlineFrom = String(heading.from);
    item.style.paddingLeft = 15 + Math.min(heading.level - 1, 3) * 13 + 'px';
    item.title = heading.text;
    const intent = headingIntent(headings, index);
    item.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      richEditor.navigateHeading(intent);
    });
    item.addEventListener('click', event => { if (event.detail === 0) richEditor.navigateHeading(intent); });
    outline.appendChild(item);
    outlineItems.push(item);
  }
  const marks = find('#marks-list');
  marks.replaceChildren();
  find('#mark-count').textContent = documentSession.highlights.length;
  for (const mark of documentSession.highlights) {
    const item = document.createElement('button');
    item.className = 'mark-item';
    item.style.borderLeftColor = highlightColors[mark.color];
    item.textContent = documentSession.source.slice(mark.from, mark.to).slice(0, 120);
    item.addEventListener('click', () => reveal(mark.from, mark.to));
    marks.appendChild(item);
  }
  if (documentSession.unresolved.length) {
    const notice = document.createElement('p');
    notice.className = 'unresolved';
    notice.textContent = documentSession.unresolved.length + ' 条标记待重新定位';
    marks.appendChild(notice);
  }
  scheduleOutlineFollow();
}
function scheduleOutlineFollow() {
  if (outlineFollowFrame !== null || navigationTab !== 'outline' || !settings.sidebar || settings.focus) return;
  outlineFollowFrame = requestAnimationFrame(() => { outlineFollowFrame = null; followOutline(); });
}

function followOutline() {
  if (navigationTab !== 'outline' || !settings.sidebar || settings.focus || workspaceBusy || !outlineEntries.length || outlineModel !== richEditor.parsed) return;
  const pane = settings.rich ? 'rich' : settings.source ? 'source' : null;
  if (!pane) return;
  const container = pane === 'rich' ? richEditor.container : sourceEditor.view.scrollDOM;
  if (!container.clientHeight || !find('#outline').clientHeight) return;
  let position;
  if (scrollSync?.navigating && scrollSync.anchor) position = scrollSync.anchor.text ?? scrollSync.anchor.from ?? 0;
  else if (container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 2) position = documentSession.source.length;
  else if (pane === 'source') position = sourceEditor.topPosition;
  else {
    const range = richEditor.parsed.ranges[scrollSync.richIndex(container.getBoundingClientRect().top + 32)];
    if (!range) return;
    position = range.from;
  }
  let left = 0;
  let right = outlineEntries.length - 1;
  while (left < right) {
    const middle = Math.ceil((left + right) / 2);
    if (outlineEntries[middle].from <= position) left = middle;
    else right = middle - 1;
  }
  const item = outlineItems[left];
  if (!item) return;
  if (activeOutlineItem !== item) {
    activeOutlineItem?.removeAttribute('aria-current');
    activeOutlineItem = item;
    item.setAttribute('aria-current', 'location');
  }
  const outline = find('#outline');
  const bounds = outline.getBoundingClientRect();
  const target = item.getBoundingClientRect();
  if (target.top < bounds.top + 8 || target.bottom > bounds.bottom - 8) outline.scrollTop += target.top - bounds.top - outline.clientHeight * .35;
}
function reveal(from, to = from) {
  readingRestoreRequest++;
  if (readingTracker) { readingTracker.suspended = false; readingTracker.intent(); }
  richEditor.flush();
  if (settings.source) sourceEditor.reveal(from, to, false);
  if (settings.rich) richEditor.reveal(from, to, true, false);
  scrollSync?.navigate(from);
  readingTracker?.moved();
  scheduleOutlineFollow();
}
function synchronizeScroll(pane) {
  scrollSync?.scroll(pane);
  readingTracker?.moved();
  if (pane === 'rich' || !settings.rich) scheduleOutlineFollow();
}
function sidebarLimits() {
  const sidebar = find('.sidebar');
  const minimum = parseFloat(getComputedStyle(sidebar).minWidth) || 226;
  const body = find('.app-body');
  const style = getComputedStyle(body);
  const available = body.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - (parseFloat(style.columnGap) || 0);
  return { minimum, maximum: Math.max(minimum, Math.min(640, available - 400)), enabled: innerWidth > 760 };
}

function applySidebarWidth(value = settings.sidebarWidth) {
  const limits = sidebarLimits();
  const requested = Number(value);
  const width = limits.enabled ? Math.round(Math.max(limits.minimum, Math.min(limits.maximum, Number.isFinite(requested) && requested > 0 ? requested : limits.minimum))) : limits.minimum;
  const sidebar = find('.sidebar');
  sidebar.style.width = width + 'px';
  sidebar.classList.toggle('sidebar-expanded', width > limits.minimum);
  const handle = find('#sidebar-resizer');
  handle.hidden = !limits.enabled;
  handle.setAttribute('aria-valuemin', String(limits.minimum));
  handle.setAttribute('aria-valuemax', String(limits.maximum));
  handle.setAttribute('aria-valuenow', String(width));
  handle.setAttribute('aria-valuetext', width + ' 像素');
  scheduleOutlineFollow();
  return width;
}

function saveSidebarWidth(value) {
  settings.sidebarWidth = value;
  applySidebarWidth(value);
  call('settings', settings).catch(showError);
  scrollSync?.refresh();
}

const sidebarHandle = find('#sidebar-resizer');
sidebarHandle.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !sidebarLimits().enabled || workspaceBusy || detaching || incomingTransfer) return;
  event.preventDefault();
  sidebarDrag = { pointerId: event.pointerId, startX: event.clientX, width: find('.sidebar').getBoundingClientRect().width, previous: settings.sidebarWidth, direction: settings.outlineSide === 'right' ? -1 : 1 };
  sidebarHandle.focus({ preventScroll: true });
  sidebarHandle.setPointerCapture(event.pointerId);
  document.body.classList.add('sidebar-sizing');
});
sidebarHandle.addEventListener('pointermove', event => {
  if (!sidebarDrag || sidebarDrag.pointerId !== event.pointerId) return;
  sidebarDrag.next = sidebarDrag.width + (event.clientX - sidebarDrag.startX) * sidebarDrag.direction;
  if (sidebarResizeFrame === null) sidebarResizeFrame = requestAnimationFrame(() => {
    sidebarResizeFrame = null;
    if (sidebarDrag) applySidebarWidth(sidebarDrag.next);
  });
});
function finishSidebarResize(cancelled = false) {
  if (!sidebarDrag) return;
  const drag = sidebarDrag; sidebarDrag = null;
  if (sidebarResizeFrame !== null) cancelAnimationFrame(sidebarResizeFrame);
  sidebarResizeFrame = null;
  document.body.classList.remove('sidebar-sizing');
  if (sidebarHandle.hasPointerCapture(drag.pointerId)) sidebarHandle.releasePointerCapture(drag.pointerId);
  if (cancelled) applySidebarWidth(drag.previous);
  else saveSidebarWidth(applySidebarWidth(drag.next ?? drag.width));
}
sidebarHandle.addEventListener('pointerup', () => finishSidebarResize());
sidebarHandle.addEventListener('pointercancel', () => finishSidebarResize(true));
sidebarHandle.addEventListener('lostpointercapture', () => finishSidebarResize(true));
sidebarHandle.addEventListener('dblclick', () => saveSidebarWidth(0));
sidebarHandle.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') { finishSidebarResize(true); return; }
  const limits = sidebarLimits();
  if (event.key === 'Home') saveSidebarWidth(0);
  else if (event.key === 'End') saveSidebarWidth(limits.maximum);
  else saveSidebarWidth(applySidebarWidth() + (event.key === 'ArrowRight' ? 20 : -20) * (settings.outlineSide === 'right' ? -1 : 1));
});
window.addEventListener('resize', () => applySidebarWidth(sidebarDrag ? sidebarDrag.next ?? sidebarDrag.width : settings.sidebarWidth));
function applySettings(persist = true) {
  if (!interfaceThemes[settings.interfaceTheme]) settings.interfaceTheme = 'jade';
  const shell = interfaceThemes[settings.interfaceTheme];
  document.documentElement.dataset.interfaceTheme = settings.interfaceTheme;
  document.documentElement.dataset.uiMode = shell.family === 'dark' ? 'dark' : 'light';
  for (const token of ['base', 'secondary', 'ink', 'muted', 'accent']) document.documentElement.style.setProperty('--ui-' + token, shell[token]);
  find('#interface-family-input').value = shell.family;
  for (const option of document.querySelectorAll('[data-interface-theme]')) {
    if (option === document.documentElement) continue;
    option.setAttribute('aria-pressed', String(option.dataset.interfaceTheme === settings.interfaceTheme));
    option.hidden = interfaceThemes[option.dataset.interfaceTheme].family !== shell.family;
  }
  const sourceBackground = themes[settings.leftTheme] || themes.white;
  const readingBackground = themes[settings.rightTheme] || themes.white;
  find('#diagram-viewport').dataset.paperMode = readingBackground.family === 'dark' ? 'dark' : 'light';
  find('#diagram-viewport').style.backgroundColor = readingBackground.value;
  for (const [selector, theme] of [['.source-pane', sourceBackground], ['.rich-pane', readingBackground]]) {
    const pane = find(selector);
    pane.dataset.paperMode = theme.family === 'dark' ? 'dark' : 'light';
    for (const [token, value] of Object.entries({ bg: theme.value, ink: theme.ink || '#303831', muted: theme.muted || '#77847b', accent: theme.accent || '#286d5a' })) pane.style.setProperty('--pane-' + token, value);
  }
  find('#source-family-input').value = sourceBackground.family;
  find('#reader-family-input').value = readingBackground.family;
  document.documentElement.style.setProperty('--source-bg', sourceBackground.value);
  document.documentElement.style.setProperty('--reader-bg', readingBackground.value);
  document.documentElement.style.setProperty('--reading-size', Math.max(14, Math.min(24, settings.fontSize)) + 'px');
  document.documentElement.style.setProperty('--reading-font', readingFonts[settings.readingFont] || readingFonts.book);
  document.documentElement.style.setProperty('--reading-line-height', Math.max(1.6, Math.min(2.6, Number(settings.lineHeight) || 2.05)));
  document.documentElement.style.setProperty('--reading-paragraph-gap', Math.max(0.5, Math.min(1.6, Number(settings.paragraphGap) || 1)) + 'em');
  document.documentElement.style.setProperty('--reading-width', Math.max(520, Math.min(960, Number(settings.readingWidth) || 720)) + 'px');
  find('.source-pane').dataset.paper = String(sourceBackground.paper && settings.paperTexture !== false);
  find('.rich-pane').dataset.paper = String(readingBackground.paper && settings.paperTexture !== false);
  document.body.classList.toggle('hide-sidebar', !settings.sidebar || settings.focus);
  find('.app-body').dataset.outlineSide = settings.outlineSide === 'right' ? 'right' : 'left';
  find('#outline-side-input').value = settings.outlineSide === 'right' ? 'right' : 'left';
  applySidebarWidth();
  document.body.classList.toggle('focus-mode', settings.focus);
  find('.source-pane').hidden = !settings.source;
  find('.rich-pane').hidden = !settings.rich;
  find('#splitter').hidden = !(settings.source && settings.rich);
  find('#workspace').classList.toggle('one-pane', !(settings.source && settings.rich));
  find('#empty-workspace').hidden = settings.source || settings.rich;
  for (const action of ['source', 'rich', 'focus', 'typewriter']) {
    const target = find('.view-tools [data-action="' + action + '"]');
    target.classList.toggle('active', settings[action]);
    target.setAttribute('aria-pressed', String(settings[action]));
  }
  for (const target of document.querySelectorAll('[data-theme]')) {
    const active = settings[target.dataset.themeSide] === target.dataset.theme;
    const selectedTheme = themes[settings[target.dataset.themeSide]] || themes.white;
    target.hidden = themes[target.dataset.theme].family !== selectedTheme.family;
    target.classList.toggle('active', active);
    target.setAttribute('aria-pressed', String(active));
  }
  find('#font-input').value = settings.fontSize;
  find('#font-output').textContent = settings.fontSize + ' px';
  find('#font-size').textContent = settings.fontSize;
  find('#reading-font-input').value = settings.readingFont;
  find('#line-height-input').value = settings.lineHeight;
  find('#line-height-output').textContent = Number(settings.lineHeight).toFixed(2) + ' 倍';
  find('#paragraph-gap-input').value = settings.paragraphGap;
  find('#paragraph-gap-output').textContent = Number(settings.paragraphGap).toFixed(1) + ' 倍';
  find('#reading-width-input').value = settings.readingWidth;
  find('#reading-width-output').textContent = settings.readingWidth + ' px';
  find('#paper-input').checked = settings.paperTexture !== false;
  find('#opacity-input').value = settings.opacity * 100;
  find('#opacity-output').textContent = Math.round(settings.opacity * 100) + '%';
  find('#sync-input').checked = settings.syncScroll;
  find('#restore-reading-input').checked = settings.restoreReadingPosition === true;
  find('#search-results-input').checked = settings.searchResults === true;
  find('#ctrl-wheel-input').checked = settings.ctrlWheelZoom !== false;
  find('#separate-windows-input').checked = settings.separateWindows === true;
  find('#separate-windows-setting').hidden = !multipleWindows;
  find('#detach-file-button').hidden = !multipleWindows;
  find('#compress-input').checked = settings.compress;
  find('#embed-images-input').checked = settings.embedImages === true;
  const palette = codePalette(codeColorScope, settings.codeColors || {});
  for (const input of document.querySelectorAll('[data-code-color]')) input.value = palette[input.dataset.codeColor];
  sourceEditor.refresh(); richEditor.refresh();
  renderSearchResults();
  scrollSync?.refresh();
  scheduleOutlineFollow();
  if (persist) call('settings', settings).catch(showError);
}
async function confirmDiscard() {
  if (!dirty()) return true;
  return await new Promise(resolve => {
    const content = find('#edit-content');
    content.innerHTML = '<p>当前文档有未保存的修改。</p><div class="confirm-actions"><button type="button" class="primary-command" id="confirm-save">保存并继续</button><button type="button" class="small-command" id="confirm-discard">放弃修改</button></div>';
    find('#edit-title').textContent = '未保存的修改';
    find('#edit-form .dialog-footer').hidden = true;
    const dialog = find('#edit-dialog');
    let settled = false;
    const finish = value => { if (!settled) { settled = true; dialog.close(); resolve(value); } };
    find('#confirm-save').onclick = async () => { if (await save()) finish(true); };
    find('#confirm-discard').onclick = () => finish(true);
    dialog.addEventListener('close', () => { finish(false); find('#edit-form .dialog-footer').hidden = false; }, { once: true });
    dialog.showModal();
  });
}
async function loadDocument(data, restored = false) {
  await readingTracker?.flush().catch(() => {});
  find('#image-access').hidden = true;
  externalSnapshot = null;
  find('#external-change').hidden = true;
  clearTimeout(searchTimer);
  recoveryWriter?.reset();
  selectDocument(recoveryDocumentId);
  richEditor.pending = undefined;
  documentSession.source = data.text || '';
  documentSession.revision++;
  savedRevision = restored ? -1 : documentSession.revision;
  const annotations = restoreHighlights(documentSession.source, data.annotations?.marks, !!data.hash && data.annotations?.textHash === data.hash);
  documentSession.highlights = annotations.highlights;
  documentSession.unresolved = annotations.unresolved;
  documentSession.past = []; documentSession.future = [];
  documentInfo = { name: data.name || '未命名.md', path: data.path || null, hash: data.hash || null };
  selection = { from: 0, to: 0 };
  sourceEditor.setText(documentSession.source);
  richEditor.load(documentSession.source);
  results = []; totalResults = 0; resultsRevision = -1; selectedResult = -1; searchId++;
  searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
  find('#selection-tools').hidden = true;
  sourceEditor.view.scrollDOM.scrollTop = 0;
  find('#rich-editor').scrollTop = 0;
  updateStatus(); updateNavigation();
  if (!find('#search-panel').hidden) scheduleSearch();
  if (restored) recoveryWriter?.schedule();
  if (data.historyWarning) toast(data.historyWarning, true);
  await initializeReadingPosition(!restored);
}
function confirmImageSave(issues) {
  const dialog = find('#save-images-dialog');
  const list = find('#save-image-issues'); list.replaceChildren();
  for (const issue of issues) {
    const item = document.createElement('li');
    item.textContent = (issue.alt ? issue.alt + '：' : '') + issue.displayPath + '；' + issue.message;
    list.append(item);
  }
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'save'), { once: true });
    dialog.showModal();
  });
}
async function save(saveAs = false) {
  if (saving || externalRefreshBusy) return false;
  saving = true; updateStatus();
  let revision = documentSession.revision;
  let prepared;
  let relocated;
  const originalSelection = { ...selection };
  const wasInert = find('#workspace').inert;
  try {
    await readingTracker.flush().catch(() => {});
    await recoveryWriter?.flush().catch(() => {});
    richEditor.flush();
    revision = documentSession.revision;
    const savingSession = documentSession;
    const source = documentSession.source;
    let text = source;
    let annotations = annotationPayload();
    const resources = [];
    richEditor.parsed.doc.descendants(node => { if (node.type.name === 'image' && !isImagePlaceholder(node.attrs.src)) resources.push(node.attrs.src); });
    if (settings.embedImages === true) {
      embeddingSave = true; find('#workspace').inert = true; find('#selection-tools').hidden = true; document.activeElement?.blur();
      const { embedDocumentImages } = await import('./embedded-images.js');
      const { prepareEmbeddedAsset } = await import('./export-document.js');
      prepared = await embedDocumentImages(source, { readAsset: path => call('readAsset', { path }), convertAsset: prepareEmbeddedAsset, allowMissingImages: true });
      if (savingSession !== documentSession || revision !== documentSession.revision) throw new Error('文档已变化，请重新保存，未写入旧的转换结果。');
      if (prepared.issues.length && !await confirmImageSave(prepared.issues)) return false;
      if (savingSession !== documentSession || revision !== documentSession.revision) throw new Error('确认期间文档已变化，请重新保存，未写入旧的转换结果。');
      text = prepared.source;
      if (prepared.changes.length) {
        relocated = restoreHighlights(text, serializeHighlights(source, documentSession.highlights));
        relocated.unresolved.push(...documentSession.unresolved);
        annotations = { version: 1, marks: [...serializeHighlights(text, relocated.highlights), ...relocated.unresolved] };
      }
    }
    const result = await call('save', { text, name: documentInfo.name, hash: documentInfo.hash, annotations, resources: prepared ? [] : resources, saveAs });
    if (!result) return false;
    const oldPath = documentInfo.path;
    documentInfo = { ...documentInfo, ...result };
    if (prepared?.changes.length && revision === documentSession.revision) {
      documentSession.replaceBatch(prepared.changes, relocated);
      revision = documentSession.revision;
      sourceEditor.setText(documentSession.source); richEditor.load(documentSession.source);
      const mapPosition = position => {
        let offset = 0;
        for (const change of prepared.changes) {
          if (position < change.from) break;
          if (position <= change.to) return change.from + offset + (position === change.to ? change.insert.length : Math.min(position - change.from, change.insert.length));
          offset += change.insert.length - (change.to - change.from);
        }
        return Math.min(position + offset, documentSession.source.length);
      };
      selection = { from: mapPosition(originalSelection.from), to: mapPosition(originalSelection.to) };
      sourceEditor.view.dispatch({ selection: { anchor: selection.from, head: selection.to } });
      richEditor.reveal(selection.from, selection.to, true, false);
      searchId++; results = []; totalResults = 0; resultsRevision = -1;
      searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
      updateNavigation();
      if (!find('#search-panel').hidden) scheduleSearch();
    }
    savedRevision = revision;
    if (oldPath !== result.path) { externalSnapshot = null; find('#external-change').hidden = true; }
    if (oldPath !== result.path) richEditor.load(documentSession.source);
    if (oldPath !== result.path) await initializeReadingPosition(false);
    recoveryWriter?.reset();
    if (dirty()) recoveryWriter?.schedule();
    toast(prepared?.issues.length ? '正文已保存，未能内嵌的图片已保留原引用。' : prepared?.images ? '已保存为内嵌图片的 MD。' : '已保存到本地');
    return true;
  } catch (error) { showError(error); return false; }
  finally { saving = false; embeddingSave = false; find('#workspace').inert = wasInert; updateStatus(); resumeDocumentSwitch(); }
}
async function newDocument() {
  if (workspaceEnabled) { if (await addOpenedDocuments(await call('new'))) { if (settings.rich) richEditor.focus(); else sourceEditor.focus(); } return; }
  if (!await confirmDiscard()) return;
  await call('new');
  await loadDocument({ text: '', name: '未命名.md' });
  if (settings.rich) richEditor.focus(); else sourceEditor.focus();
}
async function openDocument() {
  if (workspaceEnabled) { await addOpenedDocuments(await call('open')); return; }
  if (!await confirmDiscard()) return;
  const data = await call('open');
  if (data) await loadDocument(data);
}

function showExternalChange(message) {
  find('#external-change-message').textContent = message;
  find('#external-change').hidden = false;
  find('[data-action="external-view"]').disabled = !externalSnapshot;
}

function queueExternalRefresh(delay = 200) {
  clearTimeout(externalTimer);
  externalTimer = setTimeout(() => refreshExternal().catch(showError), delay);
}

async function adoptExternal(data) {
  if (data.path !== documentInfo.path) return;
  const previous = documentSession.source;
  const previousSelection = { ...selection };
  const pane = settings.rich ? 'rich' : 'source';
  const anchor = (settings.rich || settings.source) && previous.length ? scrollSync.capture(pane) : null;
  const change = minimalChange(previous, data.text);
  const map = position => position <= change.from ? position : position >= change.to ? position + change.insert.length - (change.to - change.from) : change.from;
  const marks = serializeHighlights(previous, documentSession.highlights);
  const restored = restoreHighlights(data.text, marks);
  await loadDocument(data);
  if (!data.annotations) { documentSession.highlights = restored.highlights; documentSession.unresolved = restored.unresolved; }
  selection = { from: map(previousSelection.from), to: map(previousSelection.to) };
  sourceEditor.reveal(selection.from, selection.to, false);
  richEditor.refresh();
  if (anchor) {
    const mapped = { ...anchor, from: map(anchor.from || 0), ...(anchor.text === undefined ? {} : { text: map(anchor.text) }) };
    scrollSync.apply('source', mapped); scrollSync.apply('rich', mapped);
  }
  const accepted = await call('acceptExternal', { path: data.path, stamp: data.stamp });
  if (data.path !== documentInfo.path) return;
  if (!accepted) { showExternalChange('磁盘版本确认失败，当前内容已保留，可另存后重试。'); return; }
  readOnlyRecovery = null;
  updateStatus(); updateNavigation();
  toast('已同步磁盘修改');
}

async function refreshExternal() {
  if (!documentInfo.path || !desktop) return;
  if (incomingTransfer || detaching || draggingFile || externalRefreshBusy || saving || composing || workspaceBusy || closingWorkspace || document.querySelector('dialog[open]') || exportController) {
    externalRefreshQueued = true;
    queueExternalRefresh(700);
    return;
  }
  externalRefreshBusy = true;
  externalRefreshQueued = false;
  const path = documentInfo.path;
  const revision = documentSession.revision;
  try {
    richEditor.flush();
    const data = await call('readExternal', { path });
    if (path !== documentInfo.path) return;
    externalRetry = 0;
    if (!data) { externalSnapshot = null; find('#external-change').hidden = true; return; }
    externalSnapshot = data;
    if (workspace.active) workspace.active.changedExternally = false;
    if (dirty() || readOnlyRecovery || composing || revision !== documentSession.revision || document.querySelector('dialog[open]')) {
      showExternalChange(readOnlyRecovery ? '仍有未处理的恢复草稿，已保留当前内容。' : '磁盘内容已更新，当前有未保存修改。');
      return;
    }
    await adoptExternal(data);
  } catch (error) {
    if (path !== documentInfo.path) return;
    if (++externalRetry <= 3) { queueExternalRefresh(650); return; }
    externalSnapshot = null;
    showExternalChange('磁盘文件暂时无法读取，当前内容已保留。' + error.message);
  } finally {
    externalRefreshBusy = false;
    if (externalRefreshQueued) queueExternalRefresh(400);
    resumeDocumentSwitch();
  }
}
async function showOpenHistory() {
  const list = find('#history-list');
  list.replaceChildren();
  list.textContent = '正在读取...';
  find('#history-count').textContent = '';
  find('#history-dialog').showModal();
  try {
    const entries = await call('history');
    list.replaceChildren();
    if (!entries.length) list.textContent = '暂无打开记录';
    const formatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' });
    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'history-entry'; row.title = entry.Path;
      const name = document.createElement('strong'); name.textContent = entry.Name;
      const path = document.createElement('span'); path.className = 'history-path'; path.textContent = entry.Path;
      const time = document.createElement('time'); time.dateTime = entry.OpenedAt; time.textContent = formatter.format(new Date(entry.OpenedAt));
      row.append(name, time, path);
      row.addEventListener('click', () => reopenHistory(entry.Id));
      list.append(row);
    }
    find('#history-count').textContent = entries.length + ' 条记录';
  } catch (error) { list.textContent = '历史记录读取失败。'; showError(error); }
}
async function reopenHistory(id) {
  if (openingHistory) return;
  openingHistory = true;
  try {
    if (!workspaceEnabled && !await confirmDiscard()) return;
    const data = await call('openHistory', { id });
    if (data?.missing) {
      find('#history-error-message').textContent = '原地址无该文件。';
      find('#history-error-path').textContent = data.path;
      find('#history-error-dialog').showModal();
    } else if (data) {
      find('#history-dialog').close();
      if (workspaceEnabled) await addOpenedDocuments(data); else await loadDocument(data);
    }
  } catch (error) {
    find('#history-error-message').textContent = error.message || '文件无法读取。';
    find('#history-error-path').textContent = '';
    find('#history-error-dialog').showModal();
  } finally { openingHistory = false; }
}
function openCodeDialog(kind, value, apply) {
  const titles = { mermaid: '编辑 Mermaid 图表', math_block: '编辑数学公式', math_inline: '编辑行内公式', code: '插入代码块', link: '插入链接' };
  find('#edit-title').textContent = titles[kind] || '编辑';
  find('#edit-content').innerHTML = '<label class="editor-label" for="block-input">' + (kind === 'link' ? '链接地址' : '源码') + '</label><textarea id="block-input" spellcheck="false" rows="10"></textarea>';
  find('#block-input').value = value;
  if (kind === 'code') {
    const label = document.createElement('label'); label.className = 'select-setting'; label.textContent = '编程语言';
    const select = document.createElement('select'); select.id = 'block-language';
    for (const [key, name] of codeLanguages) select.add(new Option(name, key));
    label.append(select); find('#edit-content').prepend(label);
  }
  dialogApply = () => apply(find('#block-input').value, find('#block-language')?.value || 'plaintext');
  find('#edit-dialog').showModal();
  find('#block-input').focus();
}

function resizeDiagramPreview() {
  if (!find('#diagram-dialog').open) return;
  const viewport = find('#diagram-viewport');
  const width = Math.max(180, viewport.clientWidth - 40);
  find('#diagram-stage').style.width = Math.round(width * diagramZoom) + 'px';
  find('#diagram-zoom').textContent = Math.round(diagramZoom * 100) + '%';
  find('[data-action="diagram-zoom-out"]').disabled = diagramZoom <= .25;
  find('[data-action="diagram-zoom-in"]').disabled = diagramZoom >= 4;
}

async function openDiagramPreview(code, edit) {
  const request = ++diagramRequest;
  diagramZoom = 1; diagramEdit = edit;
  find('#diagram-stage').textContent = '正在准备图表...';
  if (!find('#diagram-dialog').open) find('#diagram-dialog').showModal();
  resizeDiagramPreview();
  const markup = await renderMarkup('mermaid', code, themes[settings.rightTheme]?.family === 'dark' ? 'dark' : 'neutral');
  if (request !== diagramRequest || !find('#diagram-dialog').open) return;
  find('#diagram-stage').innerHTML = markup;
  find('#diagram-viewport').scrollTop = 0; find('#diagram-viewport').scrollLeft = 0;
  resizeDiagramPreview();
}
function insert(text, replace = true) {
  const from = selection.from;
  const to = replace ? selection.to : selection.from;
  changeDocument({ from, to, insert: text }, 'command');
  selection = { from: from + text.length, to: from + text.length };
  richEditor.flush();
  if (activePane === 'source') { sourceEditor.reveal(selection.from); sourceEditor.focus(); }
  else { richEditor.reveal(selection.from); richEditor.focus(); }
}
function format(action) {
  if (activePane === 'rich' && richEditor.format(action)) return;
  const selected = documentSession.source.slice(selection.from, selection.to);
  const wrappers = { bold: '**', italic: '*', strike: '~~', code: '`' };
  if (wrappers[action]) { insert(wrappers[action] + (selected || '文字') + wrappers[action]); return; }
  const prefixes = { heading: '## ', bullet: '- ', ordered: '1. ', quote: '> ' };
  if (prefixes[action]) {
    const start = documentSession.source.lastIndexOf('\n', selection.from - 1) + 1;
    const endIndex = documentSession.source.indexOf('\n', selection.to);
    const end = endIndex < 0 ? documentSession.source.length : endIndex;
    changeDocument({ from: start, to: end, insert: documentSession.source.slice(start, end).split('\n').map(line => prefixes[action] + line).join('\n') }, 'command');
    return;
  }
  if (action.endsWith('-add') || action.endsWith('-delete')) toast('请先将光标放入表格。');
}
function reloadDocumentImages() {
  find('#image-access').hidden = true;
  for (const image of find('#rich-editor').querySelectorAll('img[data-image-source]')) {
    const url = assetUrl(image.dataset.imageSource);
    image.src = url && !url.startsWith('data:') ? url + (url.includes('?') ? '&' : '?') + 'reload=' + Date.now() : url;
  }
}
async function importImages(files) {
  if (incomingTransfer || detaching || draggingFile || workspaceBusy || closingWorkspace || imageImportBusy) return;
  imageImportBusy = true;
  try {
  for (const file of files) {
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) { toast('支持 PNG、JPEG、WebP、GIF 和 BMP 图片。', true); continue; }
    if (file.size > 25 * 1024 * 1024) { toast('单张图片不能超过 25 MB。', true); continue; }
    let blob = file;
    if (settings.compress && file.type !== 'image/gif') {
      const bitmap = await createImageBitmap(file);
      if (Math.max(bitmap.width, bitmap.height) > 1920) {
        const scale = 1920 / Math.max(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        blob = await new Promise(resolve => canvas.toBlob(resolve, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88));
      }
      bitmap.close();
    }
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    const result = await call('importImage', { name: file.name || '图片', mime: blob.type, data: dataUrl.split(',')[1] });
    if (result) {
      const inserted = imageInsertion(documentSession.source, selection.from, selection.to, { src: result.path, alt: file.name || '图片' });
      if (inserted.change) changeDocument(inserted.change, 'command');
      richEditor.flush();
      selection = { from: inserted.cursor, to: inserted.cursor };
      if (activePane === 'source') { sourceEditor.reveal(inserted.cursor); sourceEditor.focus(); }
      else { richEditor.reveal(inserted.cursor); richEditor.focus(); }
    }
  }
  } finally { imageImportBusy = false; resumeDocumentSwitch(); }
}
function pasteImages(event) {
  const files = [...(event.clipboardData?.files || [])].filter(file => file.type.startsWith('image/'));
  if (!files.length) return false;
  event.preventDefault(); importImages(files).catch(showError); return true;
}
function dropFiles(event) {
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return false;
  event.preventDefault();
  const images = files.filter(file => file.type.startsWith('image/'));
  if (images.length) importImages(images).catch(showError);
  else if (/\.(md|markdown|txt)$/i.test(files[0].name)) (async () => {
    for (const file of files.filter(file => /\.(md|markdown|txt)$/i.test(file.name))) {
      if (file.size > 24 * 1024 * 1024) throw new Error('当前版本支持不超过 24 MB 的 Markdown 文件。');
      if (!workspaceEnabled && !await confirmDiscard()) return;
      const draft = await call('new');
      const data = { ...draft, text: (await file.text()).replace(/\r\n/g, '\n'), name: file.name };
      if (workspaceEnabled) await addOpenedDocuments(data, true); else await loadDocument(data, true);
    }
  })().catch(showError);
  return true;
}
function toggleSearch(show = find('#search-panel').hidden) {
  find('#search-panel').hidden = !show;
  if (show) { find('#selection-tools').hidden = true; find('#search-input').focus(); find('#search-input').select(); scheduleSearch(); }
  else { clearTimeout(searchTimer); searchId++; searching = false; invalidateSearch(); reportSearchState(); }
}

function renderSearchResults() {
  const panel = find('#search-results-panel');
  panel.hidden = settings.searchResults !== true || find('#search-panel').hidden || !settings.rich;
  const list = find('#search-results-list');
  list.replaceChildren(); searchGroups = [];
  if (panel.hidden) return;
  if (results.length && resultsRevision === documentSession.revision) {
    richEditor.flush();
    searchGroups = groupSearchMatches(results, outlineOf(richEditor.parsed));
  }
  find('#search-results-summary').textContent = searching ? '查找中...' : searchFailed ? '查找暂不可用' : totalResults > results.length ? `前 ${results.length.toLocaleString()} / 共 ${totalResults.toLocaleString()} 处` : `${totalResults.toLocaleString()} 处 · ${searchGroups.length} 个位置`;
  if (!searchGroups.length) {
    const empty = document.createElement('p'); empty.className = 'search-results-empty';
    empty.textContent = searching ? '查找中...' : searchFailed ? '查找暂不可用' : '暂无匹配'; list.append(empty); return;
  }
  const revision = resultsRevision;
  const request = searchId;
  for (const [index, group] of searchGroups.entries()) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'search-result-heading';
    row.dataset.groupIndex = index; row.title = group.title;
    const title = document.createElement('span'); title.className = 'search-result-title'; title.textContent = group.title;
    const count = document.createElement('span'); count.className = 'search-result-count'; count.textContent = group.count.toLocaleString();
    row.append(title, count);
    row.addEventListener('click', () => { if (request === searchId && revision === documentSession.revision) selectMatch(group.firstMatch); });
    list.append(row);
  }
  highlightSearchGroup();
}

function highlightSearchGroup() {
  const active = searchGroups.findIndex(group => selectedResult >= group.firstMatch && selectedResult <= group.lastMatch);
  for (const row of find('#search-results-list').querySelectorAll('[data-group-index]')) {
    const current = Number(row.dataset.groupIndex) === active;
    row.classList.toggle('active', current);
    if (current) row.setAttribute('aria-current', 'true'); else row.removeAttribute('aria-current');
  }
  find('#search-results-list [aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}
function reportSearchState(failed = false) {
  if (desktop) call('searchState', { active: !find('#search-panel').hidden, queryLength: find('#search-input').value.length, matches: totalResults, failed }).catch(() => {});
}
function invalidateSearch() {
  const painted = results.length > 0;
  results = []; totalResults = 0; selectedResult = -1; resultsRevision = -1;
  find('#search-count').textContent = '0 处';
  find('#search-time').textContent = '';
  for (const action of ['previous', 'next', 'replace', 'replace-all']) find(`#search-panel [data-action="${action}"]`).disabled = true;
  if (painted) { sourceEditor.refresh(); richEditor.refresh(); }
  renderSearchResults();
}
function scheduleSearch() {
  clearTimeout(searchTimer); searchId++;
  searching = !find('#search-panel').hidden && !!find('#search-input').value;
  invalidateSearch();
  if (find('#search-panel').hidden || !find('#search-input').value) { reportSearchState(); return; }
  find('#search-count').textContent = '查找中...';
  searchTimer = setTimeout(() => {
    reportSearchState();
    if (searchFailed) {
      searchWorker = new Worker(new URL('./search-worker.js', import.meta.url), { type: 'module' });
      searchWorker.onmessage = receiveSearchResults;
      searchWorker.onerror = handleSearchFailure;
      searchWorker.addEventListener('messageerror', handleSearchFailure);
      searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
      searchFailed = false;
    }
    searchWorker.postMessage({ type: 'search', id: searchId, revision: documentSession.revision, query: find('#search-input').value, options: { sensitive: find('#case-toggle').getAttribute('aria-pressed') === 'true' } });
  }, 80);
}
function receiveSearchResults(event) {
  if (find('#search-panel').hidden || event.data.id !== searchId || event.data.revision !== documentSession.revision) return;
  results = event.data.matches.slice(0, 5000).filter(match => Number.isInteger(match.from) && Number.isInteger(match.to) && match.from >= 0 && match.to > match.from && match.to <= documentSession.source.length);
  totalResults = event.data.count; selectedResult = -1; resultsRevision = documentSession.revision; searching = false;
  find('#search-count').textContent = totalResults.toLocaleString() + ' 处' + (totalResults > results.length ? ' · 前 ' + results.length : '');
  find('#search-time').textContent = Math.round(event.data.duration) + ' ms';
  for (const action of ['previous', 'next', 'replace', 'replace-all']) find(`#search-panel [data-action="${action}"]`).disabled = !results.length || (action === 'replace-all' && totalResults > results.length);
  sourceEditor.refresh(); richEditor.refresh();
  renderSearchResults();
  reportSearchState();
}
function handleSearchFailure(event) {
  event.preventDefault();
  clearTimeout(searchTimer);
  searchFailed = true;
  searching = false;
  searchWorker.terminate();
  searchId++;
  invalidateSearch();
  find('#search-count').textContent = '查找暂不可用';
  reportSearchState(true);
  toast('查找进程异常，请重新输入查找内容重试。', true);
}
searchWorker.onmessage = receiveSearchResults;
searchWorker.onerror = handleSearchFailure;
searchWorker.addEventListener('messageerror', handleSearchFailure);
function nextMatch(direction) {
  if (!results.length || resultsRevision !== documentSession.revision) return;
  selectMatch((selectedResult + direction + results.length) % results.length);
}
function selectMatch(index) {
  if (!results[index] || resultsRevision !== documentSession.revision) return;
  selectedResult = index;
  const match = results[selectedResult];
  reveal(match.from, match.to);
  find('#search-count').textContent = (selectedResult + 1) + ' / ' + totalResults.toLocaleString();
  highlightSearchGroup();
}
function replaceCurrent() {
  if (!results.length || resultsRevision !== documentSession.revision) return;
  if (selectedResult < 0) nextMatch(1);
  const match = results[selectedResult];
  changeDocument({ ...match, insert: find('#replace-input').value }, 'command');
  results = []; selectedResult = -1; scheduleSearch();
}
async function replaceAll() {
  if (!results.length || resultsRevision !== documentSession.revision) return;
  if (totalResults > results.length) { toast('匹配数量超过 5000，请缩小查找范围后替换。', true); return; }
  const replacement = find('#replace-input').value;
  const count = results.length;
  const previous = documentSession.source;
  if (documentSession.replaceBatch(results.map(match => ({ ...match, insert: replacement })))) {
    sourceEditor.replace(minimalChange(previous, documentSession.source));
    richEditor.load(documentSession.source);
    searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
    changed();
  }
  results = []; scheduleSearch(); toast('已替换 ' + count + ' 处，可撤销。');
}
function tableDialog() {
  find('#edit-title').textContent = '插入表格';
  find('#edit-content').innerHTML = '<div class="table-size"><label>行数<input type="number" id="table-rows" min="2" max="100" value="3" required></label><label>列数<input type="number" id="table-columns" min="1" max="20" value="3" required></label></div>';
  dialogApply = () => {
    const rows = Math.min(100, Math.max(2, Number(find('#table-rows').value)));
    const columns = Math.min(20, Math.max(1, Number(find('#table-columns').value)));
    const header = '| ' + Array.from({ length: columns }, (_, index) => '列 ' + (index + 1)).join(' | ') + ' |';
    const separator = '| ' + Array(columns).fill('---').join(' | ') + ' |';
    const row = '| ' + Array(columns).fill(' ').join(' | ') + ' |';
    insert('\n\n' + [header, separator, ...Array(rows - 1).fill(row)].join('\n') + '\n\n');
  };
  find('#edit-dialog').showModal();
}
async function action(name) {
  if (embeddingSave) return;
  if (incomingTransfer || detaching || draggingFile) return;
  if (name === 'cancel-workspace-close') { workspaceCloseDialog.close(); return; }
  if (workspaceBusy || closingWorkspace) return;
  if (name === 'reading-start' || name === 'reading-return') {
    await readingTracker.flush().catch(() => {});
    if (name === 'reading-return' && !readingTracker.previous) return;
    await moveToReadingPosition(name === 'reading-start' ? null : readingTracker.previous);
    readingTracker.intent(); readingTracker.moved();
    return;
  }
  if (name === 'save-workspace') return saveWorkspace();
  if (name === 'retry-images') return reloadDocumentImages();
  if (name === 'dismiss-images') { find('#image-access').hidden = true; return; }
  if (name === 'detach-file') return detachDocument();
  if (name === 'close-workspace') return closeDocuments(workspaceEntries().map(entry => entry.id));
  if (name === 'search-results-close') { settings.searchResults = false; applySettings(); return; }
  if (name === 'diagram-close') { find('#diagram-dialog').close(); return; }
  if (name === 'diagram-source') { const edit = diagramEdit; find('#diagram-dialog').close(); edit?.(); return; }
  if (['diagram-zoom-in', 'diagram-zoom-out', 'diagram-fit'].includes(name)) {
    diagramZoom = name === 'diagram-fit' ? 1 : Math.max(.25, Math.min(4, diagramZoom * (name === 'diagram-zoom-in' ? 1.25 : .8)));
    resizeDiagramPreview(); return;
  }
  if (name === 'new') return newDocument();
  if (name === 'open') return openDocument();
  if (name === 'open-history') return showOpenHistory();
  if (name === 'save') return save();
  if (name === 'save-as') return save(true);
  if (name === 'undo' || name === 'redo') return history(name);
  if (['source', 'rich', 'sidebar', 'focus', 'typewriter'].includes(name)) { settings[name] = !settings[name]; applySettings(); return; }
  if (name === 'settings') { applySettings(false); find('#settings-dialog').showModal(); return; }
  if (name === 'about') { find('#about-dialog').showModal(); return; }
  if (name === 'shortcuts') {
    renderShortcuts(settings.shortcuts);
    find('#shortcuts-dialog').showModal();
    return;
  }
  if (name === 'shortcuts-reset') { renderShortcuts({}); return; }
  if (name === 'code-colors-reset') {
    settings.codeColors = { ...settings.codeColors };
    delete settings.codeColors[codeColorScope];
    applySettings(); return;
  }
  if (name === 'shortcuts-save') {
    const shortcuts = Object.fromEntries([...document.querySelectorAll('[data-shortcut-command]')].map(input => [input.dataset.shortcutCommand, input.value]));
    const error = validateShortcuts(shortcuts);
    if (error) {
      const label = shortcutCommands.find(command => command.id === error.command)?.label;
      const other = shortcutCommands.find(command => command.id === error.other)?.label;
      find('#shortcut-error').textContent = error.reason === 'duplicate' ? `${label} 与 ${other} 的快捷键重复。` : error.reason === 'reserved' ? `${label} 使用了系统或文本编辑保留键。` : `${label} 需要 Ctrl/Alt 组合键或 F1-F12。`;
      return;
    }
    settings.shortcuts = Object.fromEntries(shortcutCommands.filter(command => shortcuts[command.id] !== command.shortcut).map(command => [command.id, shortcuts[command.id]]));
    applySettings();
    find('#shortcuts-dialog').close();
    toast('快捷键已保存');
    return;
  }
  if (name === 'default-app') { await call('registerDefault'); toast('已打开 Windows 默认应用设置'); return; }
  if (name === 'unify-theme') { settings.leftTheme = settings.rightTheme; applySettings(); return; }
  if (name === 'zoom-in' || name === 'zoom-out') { settings.fontSize = Math.max(14, Math.min(24, settings.fontSize + (name === 'zoom-in' ? 1 : -1))); applySettings(); return; }
  if (name === 'search') return toggleSearch(true);
  if (name === 'search-close') return toggleSearch(false);
  if (name === 'next' || name === 'previous') return nextMatch(name === 'next' ? 1 : -1);
  if (name === 'replace') return replaceCurrent();
  if (name === 'replace-all') return replaceAll();
  if (name === 'clear-highlight') return paint(null);
  if (name === 'edit-close') { find('#edit-dialog').close(); return; }
  if (name === 'image-close') { find('#image-dialog').close(); return; }
  if (name === 'image') { find('#image-input').click(); return; }
  if (name === 'table') return tableDialog();
  if (name === 'math') return openCodeDialog('math_block', 'E = mc^2', text => insert('\n\n$$\n' + text + '\n$$\n\n'));
  if (name === 'diagram') return openCodeDialog('mermaid', 'flowchart LR\n  A[开始] --> B[完成]', text => insert('\n\n```mermaid\n' + text + '\n```\n\n'));
  if (name === 'code-block') return openCodeDialog('code', '', (text, language) => insert('\n\n```' + (language === 'plaintext' ? '' : language) + '\n' + text + '\n```\n\n'));
  if (name === 'link') return openCodeDialog('link', 'https://', url => {
    if (!/^https?:\/\/[^\s<>]+$/i.test(url)) { toast('请输入有效的 HTTP 或 HTTPS 地址。', true); return; }
    insert('[' + (documentSession.source.slice(selection.from, selection.to) || '链接') + '](<' + url + '>)');
  });
  if (name === 'print') { resetExportConfirmation(); find('#export-dialog').showModal(); return; }
  if (name === 'external-view' && externalSnapshot) {
    externalPreviewSnapshot = externalSnapshot;
    find('#external-preview').value = externalPreviewSnapshot.text;
    find('#external-dialog').showModal();
    return;
  }
  if (name === 'external-save-as') return save(true);
  if (name === 'external-adopt' && externalPreviewSnapshot && !externalRefreshBusy) {
    const data = externalPreviewSnapshot;
    externalPreviewSnapshot = null;
    externalRefreshBusy = true;
    find('#external-dialog').close();
    try { await adoptExternal(data); }
    finally { externalRefreshBusy = false; queueExternalRefresh(); }
    return;
  }
  if (name === 'export-close') { exportController?.abort(); find('#export-dialog').close(); return; }
  if (name === 'document') { richEditor.focus(); return; }
  format(name);
}
document.addEventListener('pointerdown', event => {
  const file = event.target.closest('[data-document-open]');
  if (multipleWindows && file && event.button === 0 && !incomingTransfer && !detaching) dragCandidate = { id: file.dataset.documentOpen, x: event.clientX, y: event.clientY };
  if (event.target.closest('.toolbar,.selection-tools,.table-tools')) event.preventDefault();
  if (!event.target.closest('.selection-tools,.editor-pane')) find('#selection-tools').hidden = true;
});
document.addEventListener('pointermove', event => {
  if (!dragCandidate || !(event.buttons & 1) || draggingFile || Math.hypot(event.clientX - dragCandidate.x, event.clientY - dragCandidate.y) < 8) return;
  const candidate = dragCandidate; dragCandidate = null;
  if (workspaceBusy || composing || saving || closingWorkspace || imageImportBusy || externalRefreshBusy || exportController) return;
  draggingFile = true;
  suppressWorkspaceClickUntil = performance.now() + 1000;
  event.preventDefault();
  call('dragDocument', { documentId: candidate.id }).then(async result => {
    draggingFile = false;
    suppressWorkspaceClickUntil = performance.now() + 350;
    if (result?.outside) await detachDocument(candidate.id, { x: result.x, y: result.y });
  }).catch(showError).finally(() => { draggingFile = false; resumeDocumentSwitch(); });
});
document.addEventListener('pointerup', () => { dragCandidate = null; });
document.addEventListener('pointercancel', () => { dragCandidate = null; });
document.addEventListener('dragstart', event => { if (multipleWindows && event.target.closest('[data-document-open]')) event.preventDefault(); });
document.addEventListener('click', event => {
  if (performance.now() < suppressWorkspaceClickUntil && event.target.closest('[data-document-open]')) { event.preventDefault(); return; }
  const interfaceTheme = event.target.closest('button[data-interface-theme]');
  if (interfaceTheme) { settings.interfaceTheme = interfaceTheme.dataset.interfaceTheme; applySettings(); }
  const actionButton = event.target.closest('[data-action]');
  if (actionButton) action(actionButton.dataset.action).catch(showError);
  const color = event.target.closest('[data-color]');
  if (color) paint(color.dataset.color);
  const theme = event.target.closest('[data-theme]');
  if (theme) { settings[theme.dataset.themeSide] = theme.dataset.theme; applySettings(); }
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    setNavigationTab(tab.dataset.tab);
  }
  const openFile = event.target.closest('[data-document-open]');
  if (openFile) switchDocument(openFile.dataset.documentOpen).catch(showError);
  const closeFile = event.target.closest('[data-document-close]');
  if (closeFile) closeDocuments([closeFile.dataset.documentClose]).catch(showError);
});
find('#image-input').addEventListener('change', async event => { try { await importImages([...event.target.files]); } catch (error) { showError(error); } event.target.value = ''; });
find('#diagram-dialog').addEventListener('close', () => { diagramRequest++; diagramEdit = null; find('#diagram-stage').replaceChildren(); });
new ResizeObserver(resizeDiagramPreview).observe(find('#diagram-viewport'));
find('#edit-form').addEventListener('submit', event => { event.preventDefault(); dialogApply?.(); find('#edit-dialog').close(); });
function resetExportConfirmation() {
  exportImageConfirmation = null;
  find('#export-status').textContent = '';
  find('#export-submit').textContent = '导出';
}
find('#export-dialog').addEventListener('close', () => { exportController?.abort(); resetExportConfirmation(); });
find('#export-format').addEventListener('change', resetExportConfirmation);
find('#export-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (exportController) return;
  exportController = new AbortController();
  const controller = exportController;
  const format = find('#export-format').value;
  const text = documentSession.source;
  const name = documentInfo.name;
  const path = documentInfo.path;
  const confirmed = exportImageConfirmation?.source === text && exportImageConfirmation.path === path && exportImageConfirmation.format === format;
  find('#export-submit').disabled = true;
  find('#export-format').disabled = true;
  find('#export-status').textContent = '正在准备完整文档...';
  try {
    await recoveryWriter?.flush().catch(() => {});
    const { prepareExport, createWord, captureReadingTypography } = await import('./export-document.js');
    const typography = format === 'docx' ? await captureReadingTypography(richEditor.view.dom) : undefined;
    const snapshot = await prepareExport(text, {
      title: name.replace(/\.(md|markdown|txt)$/i, ''), colors: settings.codeColors || {},
      typography,
      allowMissingImages: confirmed ? new Set(exportImageConfirmation.issues.map(issue => issue.path)) : false,
      signal: controller.signal, readAsset: path => call('readAsset', { path }),
      onProgress: (current, total) => { find('#export-status').textContent = `正在生成图片与图表 ${current}/${total}`; },
    });
    controller.signal.throwIfAborted();
    find('#export-status').textContent = '正在生成 ' + format.toUpperCase() + '...';
    const payload = format === 'docx' ? { format, name, data: await createWord(snapshot) } : { format, name, html: snapshot.html };
    controller.signal.throwIfAborted();
    const result = await call('export', payload);
    if (result) { find('#export-dialog').close(); toast('已导出 ' + format.toUpperCase()); }
    else find('#export-status').textContent = '已取消导出';
  } catch (error) {
    if (error.name !== 'AbortError') {
      find('#export-status').textContent = error.message;
      if (error.name === 'ImageExportError') {
        exportImageConfirmation = { source: text, path, format, issues: error.issues };
        find('#export-submit').textContent = '继续导出';
      } else {
        exportImageConfirmation = null;
        find('#export-submit').textContent = '导出';
        showError(error);
      }
    }
  } finally {
    if (exportController === controller) exportController = null;
    find('#export-submit').disabled = false;
    find('#export-format').disabled = false;
  }
});
find('#interface-family-input').addEventListener('change', event => {
  settings.interfaceTheme = Object.keys(interfaceThemes).find(key => interfaceThemes[key].family === event.target.value);
  applySettings();
});
for (const input of document.querySelectorAll('[data-paper-family]')) input.addEventListener('change', event => {
  settings[input.dataset.paperFamily] = Object.keys(themes).find(key => themes[key].family === event.target.value);
  applySettings();
});
find('#font-input').addEventListener('input', event => { settings.fontSize = Number(event.target.value); applySettings(); });
find('#outline-side-input').addEventListener('change', event => { settings.outlineSide = event.target.value; applySettings(); });
find('#reading-font-input').addEventListener('change', event => { settings.readingFont = event.target.value; applySettings(); });
find('#line-height-input').addEventListener('input', event => { settings.lineHeight = Number(event.target.value); applySettings(); });
find('#paragraph-gap-input').addEventListener('input', event => { settings.paragraphGap = Number(event.target.value); applySettings(); });
find('#reading-width-input').addEventListener('input', event => { settings.readingWidth = Number(event.target.value); applySettings(); });
find('#paper-input').addEventListener('change', event => { settings.paperTexture = event.target.checked; applySettings(); });
find('#opacity-input').addEventListener('input', event => { settings.opacity = Number(event.target.value) / 100; applySettings(); });
find('#sync-input').addEventListener('change', event => { settings.syncScroll = event.target.checked; applySettings(); });
find('#restore-reading-input').addEventListener('change', event => { settings.restoreReadingPosition = event.target.checked; applySettings(); });
find('#search-results-input').addEventListener('change', event => { settings.searchResults = event.target.checked; applySettings(); });
find('#ctrl-wheel-input').addEventListener('change', event => { settings.ctrlWheelZoom = event.target.checked; applySettings(); });
find('#separate-windows-input').addEventListener('change', event => { settings.separateWindows = event.target.checked; applySettings(); });
let wheelZoomAt = 0;
find('#workspace').addEventListener('wheel', event => {
  if (!event.ctrlKey || event.altKey || event.metaKey || !event.deltaY || settings.ctrlWheelZoom === false) return;
  event.preventDefault(); event.stopPropagation();
  const now = performance.now();
  if (now - wheelZoomAt < 65) return;
  wheelZoomAt = now;
  action(event.deltaY < 0 ? 'zoom-in' : 'zoom-out').catch(showError);
}, { passive: false, capture: true });
find('#compress-input').addEventListener('change', event => { settings.compress = event.target.checked; applySettings(); });
find('#embed-images-input').addEventListener('change', event => {
  const requested = event.target.checked;
  event.target.checked = settings.embedImages === true;
  if (requested && !settings.embedImages) { find('#embed-warning-dialog').returnValue = ''; find('#embed-warning-dialog').showModal(); }
  else { settings.embedImages = false; applySettings(); }
});
find('#embed-warning-dialog').addEventListener('close', () => {
  if (find('#embed-warning-dialog').returnValue === 'enable') { settings.embedImages = true; applySettings(); }
  else find('#embed-images-input').checked = settings.embedImages === true;
});
find('#code-color-language').addEventListener('change', event => { codeColorScope = event.target.value; applySettings(false); });
for (const input of document.querySelectorAll('[data-code-color]')) input.addEventListener('input', event => {
  settings.codeColors = { ...settings.codeColors, [codeColorScope]: { ...settings.codeColors?.[codeColorScope], [input.dataset.codeColor]: event.target.value } };
  applySettings();
});
find('#search-input').addEventListener('input', scheduleSearch);
find('#search-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') toggleSearch(false); });
find('#case-toggle').addEventListener('click', event => { const target = event.currentTarget; target.setAttribute('aria-pressed', String(target.getAttribute('aria-pressed') !== 'true')); scheduleSearch(); });
function renderShortcuts(overrides) {
  find('#shortcuts-list').replaceChildren();
  find('#shortcut-error').textContent = '';
  for (const command of shortcutCommands) {
    const label = document.createElement('label');
    label.className = 'shortcut-row';
    const name = document.createElement('span'); name.textContent = command.label;
    const input = document.createElement('input');
    input.className = 'hotkey-input'; input.readOnly = true;
    input.dataset.shortcutCommand = command.id; input.value = shortcutFor(command, overrides);
    input.setAttribute('aria-label', command.label + '快捷键'); input.placeholder = '未设置';
    input.addEventListener('keydown', event => {
      if (event.key === 'Tab') return;
      if (event.key === 'Escape') { input.blur(); return; }
      event.preventDefault(); event.stopPropagation();
      if (['Delete', 'Backspace'].includes(event.key) && !event.ctrlKey && !event.altKey) input.value = '';
      else { const shortcut = shortcutFromEvent(event); if (shortcut) input.value = shortcut; }
      find('#shortcut-error').textContent = '';
    });
    label.append(name, input); find('#shortcuts-list').append(label);
  }
}
document.addEventListener('keydown', event => {
  if (event.target.closest('.hotkey-input') || event.isComposing || event.keyCode === 229 || event.target.closest('dialog')) return;
  if (workspaceEnabled && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'w') {
    event.preventDefault();
    closeDocuments(event.shiftKey ? workspaceEntries().map(entry => entry.id) : [recoveryDocumentId]).catch(showError);
    return;
  }
  if (workspaceEnabled && event.ctrlKey && event.key === 'Tab') {
    event.preventDefault();
    const entries = workspaceEntries(); const index = entries.findIndex(entry => entry.id === recoveryDocumentId);
    if (entries.length) switchDocument(entries[(index + (event.shiftKey ? -1 : 1) + entries.length) % entries.length].id).catch(showError);
    return;
  }
  if (workspaceBusy || closingWorkspace) return;
  const formInput = event.target.closest('input, textarea, select');
  if (formInput) return;
  const command = commandFromEvent(event, settings.shortcuts || {});
  if (command) {
    event.preventDefault(); event.stopPropagation();
    action(command).catch(showError);
  } else if (shortcutCommands.some(command => command.shortcut === shortcutFromEvent(event))) {
    event.preventDefault(); event.stopPropagation();
  }
}, true);
find('#splitter').addEventListener('pointerdown', event => {
  event.preventDefault();
  const splitter = event.currentTarget;
  splitter.setPointerCapture(event.pointerId);
  const move = pointer => {
    const bounds = find('#workspace').getBoundingClientRect();
    const ratio = Math.max(0.25, Math.min(0.75, (pointer.clientX - bounds.left) / bounds.width));
    find('#workspace').style.setProperty('--split', ratio * 100 + '%');
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', () => splitter.removeEventListener('pointermove', move), { once: true });
});
find('#splitter').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const current = parseFloat(find('#workspace').style.getPropertyValue('--split')) || 48;
    find('#workspace').style.setProperty('--split', Math.min(75, Math.max(25, current + (event.key === 'ArrowLeft' ? -5 : 5))) + '%');
  }
});
window.addEventListener('inklet:save', () => save());
window.addEventListener('inklet:open', event => workspaceEnabled ? addOpenedDocuments(event.detail).catch(showError) : loadDocument(event.detail));
window.addEventListener('inklet:settingsChanged', event => { settings = { ...settings, ...event.detail }; applySettings(false); });
window.addEventListener('inklet:selectDocument', event => { windowGate.then(() => switchDocument(event.detail.documentId)).catch(showError); });
window.addEventListener('inklet:detachReady', event => { finishDetach(event.detail.token).catch(showError); });
window.addEventListener('inklet:detachCancelled', event => { if (detaching?.token === event.detail.token) releaseTransfer(event.detail.message); });
window.addEventListener('inklet:detachCommitted', () => {
  incomingTransfer = null; find('#app').inert = false; delete find('#app').dataset.windowTransfer;
  releaseWindowGate?.(); releaseWindowGate = null; windowGate = Promise.resolve();
  updateStatus(); if (dirty()) recoveryWriter?.schedule();
});
window.addEventListener('inklet:closeWorkspace', () => closeDocuments([...workspace.entries.keys()], true).catch(showError));
let queuedOpen = Promise.resolve();
window.addEventListener('inklet:openRequest', event => {
  queuedOpen = queuedOpen.then(async () => {
    await windowGate;
    if (!workspaceEnabled && !await confirmDiscard()) { await call('dismissOpen', { id: event.detail.id }); return; }
    const opened = await call('openRequested', { id: event.detail.id });
    if (opened) { if (workspaceEnabled) await addOpenedDocuments(opened); else await loadDocument(opened); }
  }).catch(showError);
});
window.addEventListener('inklet:externalChange', event => {
  if (event.detail?.documentId && event.detail.documentId !== recoveryDocumentId) {
    const entry = workspace.entries.get(event.detail.documentId);
    if (entry) { entry.changedExternally = true; renderWorkspace(); }
    return;
  }
  if (event.detail?.path && event.detail.path !== documentInfo.path) return;
  externalRetry = 0;
  queueExternalRefresh();
});
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; if (externalRefreshQueued) queueExternalRefresh(); resumeDocumentSwitch(); });
window.addEventListener('blur', () => { recoveryWriter?.flush().catch(() => {}); readingTracker?.flush().catch(() => {}); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { recoveryWriter?.flush().catch(() => {}); readingTracker?.flush().catch(() => {}); } });
window.addEventListener('beforeunload', event => { if (!desktop && [...workspace.entries.values()].some(entry => entry.state ? entry.state.savedRevision !== entry.state.session.revision : entry.dirty)) { event.preventDefault(); event.returnValue = ''; } });

applySettings(false); updateStatus(); updateNavigation(); setNavigationTab(navigationTab);
if (incomingTransfer) { find('#app').inert = true; find('#app').dataset.windowTransfer = 'receiving'; }
searchWorker.postMessage({ type: 'document', source: documentSession.source, revision: documentSession.revision });
Promise.resolve(startupState).then(async response => {
  settings = { ...settings, ...response.settings };
  if (!settings.shortcuts || validateShortcuts(settings.shortcuts)) settings.shortcuts = {};
  if (response.settings?.backgroundPaletteVersion === undefined) {
    const legacyReading = { gray: 'paper', cyan: 'cyan', ink: 'ink-paper' };
    settings.rightTheme = legacyReading[response.settings?.rightTheme] || 'white';
    if (response.settings?.unifiedPaper) settings.leftTheme = settings.rightTheme;
  }
  settings.backgroundPaletteVersion = 1;
  delete settings.unifiedPaper;
  if (!desktop && window.innerWidth < 760 && response.settings?.source === undefined) { settings.source = false; settings.sidebar = false; }
  applySettings(false);
  if (response.recovery) {
    readOnlyRecovery = response.recovery;
    find('#edit-title').textContent = '恢复未保存的文档';
    find('#edit-content').innerHTML = '<p id="recovery-name"></p>';
    find('#recovery-name').textContent = (response.recovery.name || '未命名.md') + (response.recovery.recoveredPreviousSnapshot || response.recovery.recoveredPartialJournal ? '（最新记录不完整，将恢复最后有效副本）' : '');
    dialogApply = async () => {
      try { const restored = await call('recover', readOnlyRecovery); await loadDocument(restored, true); readOnlyRecovery = null; }
      catch (error) { showError(error); }
    };
    find('#edit-dialog').showModal();
  }
  if (response.startupWarning) {
    if (response.recovery) toast(response.startupWarning.message, true);
    else {
      find('#history-error-message').textContent = response.startupWarning.message;
      find('#history-error-path').textContent = response.startupWarning.path || '';
      find('#history-error-dialog').showModal();
    }
  }
  if (startupSession) {
    await document.fonts.ready;
    const restoredSelection = startupSession.selection || { from: 0, to: 0 };
    selection = { from: restoredSelection.from, to: restoredSelection.to };
    activePane = startupSession.view?.activePane || 'rich';
    sourceEditor.view.dispatch({ selection: { anchor: Math.min(selection.from, documentSession.source.length), head: Math.min(selection.to, documentSession.source.length) } });
    richEditor.reveal(selection.from, selection.to, true, false);
    scrollSync.reset();
    sourceEditor.view.scrollDOM.scrollTop = startupSession.view?.sourceTop || 0;
    find('#rich-editor').scrollTop = startupSession.view?.richTop || 0;
    find('#search-input').value = startupSession.search?.query || '';
    find('#replace-input').value = startupSession.search?.replacement || '';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    sourceEditor.view.scrollDOM.scrollTop = startupSession.view?.sourceTop || 0;
    find('#rich-editor').scrollTop = startupSession.view?.richTop || 0;
  }
  await initializeReadingPosition(!startupSession && !startupDocument.restored);
  if (desktop) await call('ready');
  if (startupDocument.restored) { toast('已恢复未保存的文档；其他恢复草稿保留在工作空间。'); recoveryWriter?.schedule(); }
  performance.mark('inklet-ready');
  if (startupError) showError(startupError);
  if (startupDocument.historyWarning) showError(new Error(startupDocument.historyWarning));
}).catch(showError);

if (import.meta.env.DEV) window.inkletTest = {
  load: async text => { await loadDocument({ text, name: 'test.md' }); setNavigationTab('outline'); },
  add: data => addOpenedDocuments(data),
  switch: id => switchDocument(id),
  close: ids => closeDocuments(ids),
  get workspace() { return workspace; },
  get source() { return documentSession.source; },
  get marks() { return documentSession.highlights; },
  get sourceEditor() { return sourceEditor; },
  get richEditor() { return richEditor; },
  get revision() { return documentSession.revision; },
  select: (from, to, pane = 'source') => { activePane = pane; setSelection(from, to); if (pane === 'source') { sourceEditor.reveal(from, to); sourceEditor.focus(); } else { richEditor.reveal(from, to); richEditor.focus(); } },
};