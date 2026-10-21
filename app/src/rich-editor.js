import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, wrapIn, chainCommands } from 'prosemirror-commands';
import { wrapInList, splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import { tableEditing, columnResizing, goToNextCell, addRowAfter, addColumnAfter, deleteRow, deleteColumn, deleteTable } from 'prosemirror-tables';
import { parseDocument, richChange, plainTextChange, schema, prosePosition, sourcePosition, documentHeadings } from './markdown.js';
import { highlightStyle } from './source-editor.js';
import { renderOnVisible } from './renderers.js';
import { codeLanguages, codeSpans, codeStyle, normalizeLanguage, onCodeHighlightingReady } from './code-highlighting.js';
import { TableViewport } from './table-viewport.js';
import { renderTableOfContents, headingIntent, resolveHeadingIntent } from './document-toc.js';
import { sectionReferencePlugin } from './section-references.js';
import { isImagePlaceholder, readableImagePath } from './image-references.js';
import { createElement, Code2, Image as ImageIcon } from 'lucide';

function bindFigureActivation(element, open, edit) {
  let timer;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const click = event => {
    if (event.button !== 0 || event.target.closest('.diagram-code-button')) return;
    cancel();
    if (event.detail === 0) { open(); return; }
    if (event.detail === 1) timer = setTimeout(() => { timer = null; if (element.isConnected) open(); }, 500);
  };
  const doubleClick = event => {
    if (event.target.closest('.diagram-code-button')) return;
    event.preventDefault(); event.stopPropagation(); cancel(); (edit || open)();
  };
  element.addEventListener('click', click); element.addEventListener('dblclick', doubleClick);
  return () => { cancel(); element.removeEventListener('click', click); element.removeEventListener('dblclick', doubleClick); };
}

export class RichEditor {
  constructor(element, options) {
    this.options = options;
    this.container = element;
    this.parsed = parseDocument(options.source);
    this.timer = null;
    this.tables = new TableViewport(this);
    this.contentsViews = new Set();
    this.visualViews = new Set();
    const nodeView = kind => (node, view, getPos) => {
      const dom = document.createElement(kind === 'math_inline' ? 'span' : 'div');
      dom.className = kind === 'mermaid' ? 'diagram-block' : kind.replace('_', '-');
      dom.contentEditable = 'false';
      dom.tabIndex = 0;
      dom.setAttribute('role', 'button');
      dom.setAttribute('aria-label', kind === 'mermaid' ? '查看图表' : '编辑公式');
      dom.title = kind === 'mermaid' ? '查看图表' : '编辑公式';
      let current = node;
      let theme = options.diagramTheme?.() || 'neutral';
      let dispose = renderOnVisible(dom, kind, node.attrs.code ?? node.attrs.tex, theme);
      const refreshTheme = () => {
        const next = options.diagramTheme?.() || 'neutral';
        if (kind !== 'mermaid' || theme === next) return;
        theme = next; dispose(); dispose = renderOnVisible(dom, kind, current.attrs.code, theme);
      };
      this.visualViews.add(refreshTheme);
      const edit = () => options.edit(kind, current.attrs.code ?? current.attrs.tex, text => {
        const position = getPos();
        if (position == null) return;
        const found = view.state.doc.nodeAt(position);
        if (!found || found.type !== current.type) return;
        view.dispatch(view.state.tr.setNodeMarkup(position, null, kind === 'mermaid' ? { code: text } : { tex: text }));
        view.focus();
      });
      const open = () => kind === 'mermaid' && dom.dataset.rendered === 'true' ? options.diagram(current.attrs.code, edit) : edit();
      let controlsObserver; let disposeActivation;
      if (kind === 'mermaid') {
        const codeButton = document.createElement('button');
        codeButton.type = 'button'; codeButton.className = 'diagram-code-button icon-button';
        codeButton.title = '编辑图表源码'; codeButton.setAttribute('aria-label', '编辑图表源码');
        codeButton.append(createElement(Code2, { width: 15, height: 15, 'stroke-width': 1.7 }));
        codeButton.addEventListener('click', event => { event.stopPropagation(); edit(); });
        const attachControls = () => { if (codeButton.parentNode !== dom) dom.append(codeButton); };
        controlsObserver = new MutationObserver(attachControls);
        controlsObserver.observe(dom, { childList: true });
        attachControls();
        disposeActivation = bindFigureActivation(dom, open, edit);
      } else dom.addEventListener('dblclick', edit);
      dom.addEventListener('keydown', event => { if (event.target === dom && (event.key === 'Enter' || (kind === 'mermaid' && event.key === ' '))) { event.preventDefault(); open(); } });
      return {
        dom, stopEvent: () => true,
        update(next) {
          if (next.type !== current.type) return false;
          if (!next.eq(current)) { dispose(); dispose = renderOnVisible(dom, kind, next.attrs.code ?? next.attrs.tex, theme); }
          current = next;
          return true;
        },
        destroy: () => { this.visualViews.delete(refreshTheme); controlsObserver?.disconnect(); disposeActivation?.(); dispose(); },
      };
    };
    this.plugins = [
      keymap({
        Enter: chainCommands(splitListItem(schema.nodes.list_item), baseKeymap.Enter),
        Tab: chainCommands(goToNextCell(1), sinkListItem(schema.nodes.list_item)),
        'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(schema.nodes.list_item)),
      }),
      keymap(baseKeymap), columnResizing({ View: null }), tableEditing(),
      sectionReferencePlugin({ navigate: position => {
        const range = this.parsed.ranges.find(item => item.position === position);
        if (range) this.options.navigate(range.from);
      } }),
      new Plugin({ props: { decorations: state => this.decorations(state) } }),
    ];
    this.view = new EditorView(element, {
      state: EditorState.create({ doc: this.parsed.doc, plugins: this.plugins }),
      attributes: { 'aria-label': '所见即所得编辑', spellcheck: 'false', class: 'inklet-prose' },
      nodeViews: {
        table: (node, view, getPos) => this.tables.create(node, view, getPos),
        toc: () => {
          const dom = document.createElement('nav');
          dom.className = 'document-toc'; dom.dataset.toc = ''; dom.contentEditable = 'false';
          dom.setAttribute('aria-label', '文档目录');
          renderTableOfContents(dom, documentHeadings(this.parsed.doc));
          dom.addEventListener('click', event => {
            const link = event.target.closest('a[data-heading-id]');
            if (!link) return;
            event.preventDefault();
            if (event.detail === 0) this.navigateHeading(headingIntent(documentHeadings(this.parsed.doc), Number(link.dataset.headingIndex)));
          });
          this.contentsViews.add(dom);
          return { dom, update: node => node.type.name === 'toc', ignoreMutation: () => true, stopEvent: event => !!event.target.closest('a'), destroy: () => this.contentsViews.delete(dom) };
        },
        math_inline: nodeView('math_inline'), math_block: nodeView('math_block'), mermaid: nodeView('mermaid'),
        code_block: (node, view, getPos) => {
          const dom = document.createElement('div'); dom.className = 'code-block-shell';
          const toolbar = document.createElement('div'); toolbar.className = 'code-block-toolbar'; toolbar.contentEditable = 'false';
          const select = document.createElement('select'); select.setAttribute('aria-label', '代码语言');
          for (const [value, label] of codeLanguages) select.add(new Option(label, value));
          const pre = document.createElement('pre'); const contentDOM = document.createElement('code'); pre.append(contentDOM);
          toolbar.append(select); dom.append(toolbar, pre);
          const updateLanguage = current => {
            const language = normalizeLanguage(current.attrs.params);
            if (![...select.options].some(option => option.value === language)) select.add(new Option(language, language));
            select.value = language;
          };
          updateLanguage(node);
          select.addEventListener('change', () => {
            const position = getPos();
            if (position != null) view.dispatch(view.state.tr.setNodeMarkup(position, null, { params: select.value === 'plaintext' ? '' : select.value }));
          });
          return { dom, contentDOM, stopEvent: event => toolbar.contains(event.target), update(next) { if (next.type !== node.type) return false; updateLanguage(next); return true; } };
        },
        image: node => {
          if (isImagePlaceholder(node.attrs.src)) {
            const dom = document.createElement('span');
            dom.className = 'image-placeholder'; dom.dataset.imagePlaceholder = node.attrs.src;
            dom.contentEditable = 'false'; dom.setAttribute('role', 'img');
            dom.title = readableImagePath(node.attrs.src);
            const label = '图片占位：' + (node.attrs.alt || readableImagePath(node.attrs.src));
            dom.setAttribute('aria-label', label);
            dom.append(createElement(ImageIcon, { width: 24, height: 24, 'aria-hidden': 'true' }));
            const text = document.createElement('span'); text.textContent = label; dom.append(text);
            return { dom, ignoreMutation: () => true };
          }
          const dom = document.createElement('img');
          dom.dataset.imageSource = node.attrs.src;
          dom.dataset.imageAlt = node.attrs.alt || '图片';
          dom.src = options.asset(node.attrs.src);
          dom.alt = node.attrs.alt || '图片';
          dom.title = node.attrs.title || node.attrs.alt || '图片';
          dom.loading = 'lazy';
          dom.decoding = 'async';
          dom.classList.add('document-image');
          const disposeActivation = bindFigureActivation(dom,
            () => options.image(node.attrs.src, node.attrs.alt),
            () => options.imageSource ? options.imageSource(node.attrs.src, node.attrs.alt) : options.image(node.attrs.src, node.attrs.alt));
          dom.addEventListener('error', () => { dom.classList.add('image-missing'); dom.alt = '图片不可用: ' + (node.attrs.alt || node.attrs.src); options.imageError?.(node.attrs.src, dom); });
          dom.addEventListener('load', () => { dom.classList.remove('image-missing'); dom.alt = node.attrs.alt || '图片'; options.imageLoaded?.(node.attrs.src, dom); });
          return { dom, destroy: disposeActivation };
        },
      },
      dispatchTransaction: transaction => this.dispatch(transaction),
      handleDOMEvents: {
        focus: () => { this.flush(); options.focus('rich'); },
        paste: (view, event) => options.paste(event),
        drop: (view, event) => options.drop(event),
      },
      handleClickOn: (view, position, node, nodePosition, event) => {
        const link = event.target.closest('a');
        if (link && (event.ctrlKey || event.metaKey)) { options.link(link.href); return true; }
        return false;
      },
    });
    element.addEventListener('pointerdown', event => {
      const link = event.target.closest('.document-toc a[data-heading-index]');
      if (link && event.button === 0) {
        event.preventDefault(); event.stopPropagation();
        this.navigateHeading(headingIntent(documentHeadings(this.parsed.doc), Number(link.dataset.headingIndex)));
        return;
      }
      this.flush();
    }, true);
    element.addEventListener('scroll', () => options.scroll('rich'), { passive: true });
    this.disposeHighlighting = onCodeHighlightingReady(() => this.refresh());
    options.parsed?.(this.parsed.doc);
  }

  refreshContents() {
    if (!this.contentsViews.size) return;
    const headings = documentHeadings(this.parsed.doc);
    for (const element of this.contentsViews) renderTableOfContents(element, headings);
  }

  navigateHeading(intent) {
    this.flush();
    const heading = resolveHeadingIntent(documentHeadings(this.parsed.doc), intent);
    const range = heading && this.parsed.ranges.find(item => item.position === heading.position);
    if (range) this.options.navigate(range.from);
  }

  destroy() { this.tables.destroy(); this.disposeHighlighting(); clearTimeout(this.timer); this.view.destroy(); }
  decorations(state) {
    if (!this.parsed || !state.doc.eq(this.parsed.doc)) return DecorationSet.empty;
    const marks = this.options.marks();
    const cached = this.decorationCache;
    if (!cached || cached.doc !== state.doc || cached.parsed !== this.parsed || cached.marks !== marks || !cached.selection.eq(state.selection)) {
      this.decorationCache = { doc: state.doc, parsed: this.parsed, marks, selection: state.selection, decorations: this.documentDecorations(state, marks) };
    }
    const matches = [];
    for (const match of this.options.matches()) {
      const from = prosePosition(this.parsed, match.from);
      const to = prosePosition(this.parsed, match.to);
      if (from < to) matches.push(Decoration.inline(from, to, { class: 'search-match' }));
    }
    return matches.length ? this.decorationCache.decorations.add(state.doc, matches) : this.decorationCache.decorations;
  }

  documentDecorations(state, marks) {
    const output = [];
    for (const heading of documentHeadings(state.doc)) {
      const node = state.doc.nodeAt(heading.position);
      output.push(Decoration.node(heading.position, heading.position + node.nodeSize, { id: heading.id }));
    }
    state.doc.descendants((node, position) => {
      if (node.type.name === 'table') {
        const end = position + node.nodeSize;
        const selected = [state.selection.anchor, state.selection.head].some(value => value > position && value < end);
        const loaded = state.doc.content.size < 200000 || this.tables.visible.has(node) || selected;
        output.push(Decoration.node(position, end, { 'data-table-active': String(loaded) }));
        return false;
      }
      if (node.type.name !== 'code_block') return;
      const language = normalizeLanguage(node.attrs.params);
      output.push(Decoration.node(position, position + node.nodeSize, { style: codeStyle(language, this.options.codeColors?.() || {}), 'data-code-language': language }));
      for (const span of codeSpans(node.textContent, language)) output.push(Decoration.inline(position + 1 + span.from, position + 1 + span.to, { class: span.className }));
      return false;
    });
    for (const mark of marks) {
      const from = prosePosition(this.parsed, mark.from);
      const to = prosePosition(this.parsed, mark.to);
      if (from < to) output.push(Decoration.inline(from, to, { class: 'reading-highlight', style: highlightStyle(mark) }));
    }
    const active = this.parsed.ranges.find(range => state.selection.from >= range.position && state.selection.from <= range.end);
    if (active) output.push(Decoration.node(active.position, active.end, { 'data-active': 'true' }));
    return DecorationSet.create(state.doc, output);
  }

  dispatch(transaction) {
    const next = this.view.state.applyTransaction(transaction).state;
    if (transaction.docChanged) {
      if (this.parsed.source !== this.options.sourceText()) { this.load(this.options.sourceText()); return; }
      const change = plainTextChange(this.parsed, transaction) || richChange(this.parsed.source, this.parsed.doc, next.doc, this.parsed.ranges);
      if (change) this.options.change(change);
      this.parsed = parseDocument(this.options.sourceText());
      this.options.parsed?.(this.parsed.doc);
    }
    this.view.updateState(next);
    if (transaction.docChanged) this.refreshContents();
    if (this.view.hasFocus()) {
      this.options.selection(sourcePosition(this.parsed, next.selection.from), sourcePosition(this.parsed, next.selection.to, -1));
      if (this.options.typewriter() && !transaction.getMeta('inklet-navigation') && (transaction.docChanged || transaction.selectionSet)) requestAnimationFrame(() => {
        try {
          const coords = this.view.coordsAtPos(this.view.state.selection.head);
          this.container.scrollTop += coords.top - this.container.getBoundingClientRect().top - this.container.clientHeight / 2;
        } catch {}
      });
    }
  }

  schedule(source) {
    this.pending = source;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 100);
  }
  flush() {
    clearTimeout(this.timer);
    if (this.pending !== undefined) {
      const source = this.pending;
      this.pending = undefined;
      this.load(source);
    }
  }
  load(source, cached = null) {
    const oldPosition = this.view ? sourcePosition(this.parsed, this.view.state.selection.from) : 0;
    this.parsed = cached?.source === source ? cached : parseDocument(source);
    if (this.view) {
      const position = prosePosition(this.parsed, Math.min(oldPosition, source.length));
      const selection = TextSelection.near(this.parsed.doc.resolve(Math.min(position, this.parsed.doc.content.size)));
      this.view.updateState(EditorState.create({ doc: this.parsed.doc, selection, plugins: this.plugins }));
    }
    this.refreshContents();
    this.options.parsed?.(this.parsed.doc);
  }
  refreshSearch() { this.view.updateState(this.view.state); }
  refresh() { this.decorationCache = null; this.view.updateState(this.view.state); for (const refresh of this.visualViews) refresh(); }
  focus() { this.view.focus(); }
  reveal(from, to = from, select = true, scroll = true) {
    this.flush();
    this.tables.ensure(prosePosition(this.parsed, from));
    if (select) {
      const begin = TextSelection.near(this.view.state.doc.resolve(prosePosition(this.parsed, from))).from;
      const end = TextSelection.near(this.view.state.doc.resolve(prosePosition(this.parsed, to))).from;
      const transaction = this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, begin, end)).setMeta('inklet-navigation', true);
      this.view.dispatch(scroll ? transaction.scrollIntoView() : transaction);
    } else {
      const range = this.parsed.ranges.find(item => item.to >= from);
      const element = range && this.view.nodeDOM(range.position);
      if (element?.getBoundingClientRect) this.container.scrollTop += element.getBoundingClientRect().top - this.container.getBoundingClientRect().top;
    }
  }
  format(action) {
    const commands = {
      bold: toggleMark(schema.marks.strong), italic: toggleMark(schema.marks.em), strike: toggleMark(schema.marks.strike), code: toggleMark(schema.marks.code),
      heading: setBlockType(schema.nodes.heading, { level: 2 }), paragraph: setBlockType(schema.nodes.paragraph),
      bullet: wrapInList(schema.nodes.bullet_list), ordered: wrapInList(schema.nodes.ordered_list), quote: wrapIn(schema.nodes.blockquote),
      'row-add': addRowAfter, 'column-add': addColumnAfter, 'row-delete': deleteRow, 'column-delete': deleteColumn, 'table-delete': deleteTable,
    };
    const command = commands[action];
    if (!command) return false;
    const done = command(this.view.state, this.view.dispatch, this.view);
    this.view.focus();
    return done;
  }
  get anchor() { return this.view.coordsAtPos(this.view.state.selection.from); }
  get topPosition() {
    const rect = this.container.getBoundingClientRect();
    const found = this.view.posAtCoords({ left: rect.left + Math.min(80, rect.width / 4), top: rect.top + 12 });
    return found ? sourcePosition(this.parsed, found.pos) : 0;
  }
}