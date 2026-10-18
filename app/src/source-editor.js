import { EditorState, Annotation, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, Decoration, ViewPlugin } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, foldGutter, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { languages } from '@codemirror/language-data';
import { highlightColors } from '../../core/document.mjs';
import { codeSpans, codeStyle, normalizeLanguage, onCodeHighlightingReady } from './code-highlighting.js';

const synchronized = Annotation.define();
const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: '#c0daca', fontWeight: 'bold' },
  { tag: [tags.keyword, tags.modifier], color: '#e7a9c4' },
  { tag: [tags.string, tags.special(tags.string)], color: '#aed5a4' },
  { tag: tags.comment, color: '#a4b1bc' },
  { tag: [tags.number, tags.bool], color: '#edc38a' },
  { tag: [tags.link, tags.url], color: '#9dcfe6', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.meta, color: '#ccb8e7' },
]);
export function highlightStyle(mark) {
  const color = highlightColors[mark.color] || highlightColors.yellow;
  return `background-color:rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5), 16)},${mark.opacity || 0.3});border-radius:2px`;
}

export class SourceEditor {
  constructor(element, options) {
    this.options = options;
    this.syntaxTheme = new Compartment();
    this.dark = !!options.dark?.();
    const decorated = ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = this.build(view); }
      update(update) { this.decorations = this.build(update.view); }
      build(view) {
        const ranges = [];
        const decoratedLines = new Set();
        for (const visible of view.visibleRanges) {
          syntaxTree(view.state).iterate({ from: visible.from, to: visible.to, enter(node) {
            if (node.name !== 'FencedCode') return;
            const info = node.node.getChild('CodeInfo');
            const content = node.node.getChild('CodeText');
            if (!content) return false;
            const language = normalizeLanguage(info ? view.state.sliceDoc(info.from, info.to) : 'plaintext');
            const text = view.state.sliceDoc(content.from, content.to);
            for (const span of codeSpans(text, language)) {
              const from = Math.max(content.from + span.from, visible.from);
              const to = Math.min(content.from + span.to, visible.to);
              if (from < to) ranges.push(Decoration.mark({ class: span.className }).range(from, to));
            }
            let line = view.state.doc.lineAt(Math.max(content.from, visible.from));
            while (line.from <= Math.min(content.to, visible.to)) {
              if (!decoratedLines.has(line.from)) {
                ranges.push(Decoration.line({ attributes: { style: codeStyle(language, options.codeColors?.() || {}), 'data-code-language': language } }).range(line.from));
                decoratedLines.add(line.from);
              }
              if (line.number >= view.state.doc.lines) break;
              line = view.state.doc.line(line.number + 1);
            }
            return false;
          } });
          for (const mark of options.marks()) {
            const from = Math.max(mark.from, visible.from);
            const to = Math.min(mark.to, visible.to);
            if (from < to) ranges.push(Decoration.mark({ attributes: { style: highlightStyle(mark) }, class: 'reading-highlight' }).range(from, to));
          }
          for (const match of options.matches()) {
            const from = Math.max(match.from, visible.from);
            const to = Math.min(match.to, visible.to);
            if (from < to) ranges.push(Decoration.mark({ class: 'search-match' }).range(from, to));
          }
        }
        return Decoration.set(ranges, true);
      }
    }, { decorations: value => value.decorations });
    this.view = new EditorView({
      parent: element,
      state: EditorState.create({
        doc: options.source,
        extensions: [
          lineNumbers(), foldGutter(), drawSelection(), highlightActiveLine(), bracketMatching(), markdown({ codeLanguages: languages }),
          this.syntaxTheme.of(syntaxHighlighting(this.dark ? darkHighlightStyle : defaultHighlightStyle)), EditorView.lineWrapping,
          EditorState.tabSize.of(2), decorated,
          keymap.of([
            ...defaultKeymap, indentWithTab,
          ]),
          EditorView.contentAttributes.of({ 'aria-label': 'Markdown 源码', spellcheck: 'false' }),
          EditorView.domEventHandlers({
            focus: () => { options.focus('source'); },
            paste: (event) => options.paste(event),
            drop: (event) => options.drop(event),
          }),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(synchronized))) {
              const changes = [];
              update.changes.iterChanges((from, to, fromNew, toNew, inserted) => changes.push({ from, to, insert: inserted.toString() }));
              options.change(changes);
            }
            if (this.view?.hasFocus && (update.selectionSet || update.docChanged)) {
              const selection = update.state.selection.main;
              options.selection(selection.from, selection.to);
              if (options.typewriter() && !update.transactions.some(transaction => transaction.annotation(synchronized))) requestAnimationFrame(() => this.view.dispatch({ effects: EditorView.scrollIntoView(selection.head, { y: 'center' }) }));
            }
          }),
        ],
      }),
    });
    this.view.scrollDOM.addEventListener('scroll', () => options.scroll('source'), { passive: true });
    this.disposeHighlighting = onCodeHighlightingReady(() => this.refresh());
  }

  destroy() { this.disposeHighlighting(); this.view.destroy(); }
  replace(change) { this.view.dispatch({ changes: change, annotations: synchronized.of(true) }); }
  setText(text) { this.replace({ from: 0, to: this.view.state.doc.length, insert: text }); }
  refresh() {
    const dark = !!this.options.dark?.();
    if (dark === this.dark) this.view.dispatch({});
    else { this.dark = dark; this.view.dispatch({ effects: this.syntaxTheme.reconfigure(syntaxHighlighting(dark ? darkHighlightStyle : defaultHighlightStyle)) }); }
  }
  focus() { this.view.focus(); }
  reveal(from, to = from, scroll = true) {
    const end = this.view.state.doc.length;
    this.view.dispatch({ selection: { anchor: Math.min(from, end), head: Math.min(to, end) }, annotations: synchronized.of(true), effects: scroll ? EditorView.scrollIntoView(Math.min(from, end), { y: 'center' }) : [] });
  }
  get selection() { return this.view.state.selection.main; }
  get anchor() { return this.view.coordsAtPos(this.view.state.selection.main.from); }
  get topPosition() {
    const visible = this.view.scrollDOM.getBoundingClientRect();
    const content = this.view.contentDOM.getBoundingClientRect();
    const position = this.view.posAtCoords({ x: Math.min(visible.right - 4, content.left + 4), y: visible.top + 2 }, false);
    return position ?? this.view.lineBlockAtHeight(Math.max(0, visible.top - this.view.documentTop)).from;
  }
}