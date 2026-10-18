import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { documentHeadings } from './markdown.js';

export function numberedHeadings(doc) {
  const targets = new Map();
  for (const heading of documentHeadings(doc)) {
    const match = /^\s*(?:\u00a7\s*)?(\d+(?:\.\d+)*(?:-[A-Za-z0-9]+)?)(?:\.(?!\d))?(?=$|[\s\u3001\uff0e\uff08\u4e00-\u9fff])/.exec(heading.text);
    if (!match) continue;
    const number = match[1];
    targets.set(number, targets.has(number) ? null : heading);
  }
  return targets;
}

export function sectionReferenceRanges(doc, targets = numberedHeadings(doc)) {
  const references = [];
  doc.descendants((node, position) => {
    if (node.type.spec.code || node.type.name === 'code_block') return false;
    if (!node.isTextblock) return;
    let text = '';
    let start = 0;
    const flush = () => {
      for (const match of text.matchAll(/\u00a7\s*(\d+(?:\.\d+)*(?:-[A-Za-z0-9]+)?)(?![\dA-Za-z_-]|\.\d)/g)) {
        const number = match[1];
        const target = targets.get(number);
        if (target) references.push({ from: start + match.index, to: start + match.index + match[0].length, number, target });
      }
      text = '';
    };
    node.forEach((child, offset) => {
      if (!child.isText || child.marks.some(mark => mark.type.spec.code || ['code', 'link'].includes(mark.type.name))) { flush(); return; }
      if (!text) start = position + 1 + offset;
      text += child.text;
    });
    flush();
    return false;
  });
  return references;
}

export function sectionReferencePlugin({ enabled = () => true, navigate }) {
  let cachedDoc;
  let decorations = DecorationSet.empty;
  let targets = new Map();
  const rebuild = doc => {
    if (cachedDoc === doc) return;
    cachedDoc = doc;
    targets = numberedHeadings(doc);
    decorations = DecorationSet.create(doc, sectionReferenceRanges(doc, targets).map(reference => Decoration.inline(reference.from, reference.to, {
      nodeName: 'span', class: 'section-reference', 'data-section-reference': reference.number,
      role: 'link', tabindex: '0', title: '\u8df3\u8f6c\u5230 ' + reference.target.text,
    })));
  };
  const follow = (view, event) => {
    if (!enabled()) return false;
    const link = event.target.closest?.('[data-section-reference]');
    if (!link || !view.dom.contains(link)) return false;
    rebuild(view.state.doc);
    const target = targets.get(link.dataset.sectionReference);
    if (!target) return false;
    event.preventDefault();
    event.stopPropagation();
    navigate(target.position);
    return true;
  };
  return new Plugin({ props: {
    decorations(state) { if (!enabled()) return DecorationSet.empty; rebuild(state.doc); return decorations; },
    handleDOMEvents: {
      pointerdown(view, event) { return event.button === 0 ? follow(view, event) : false; },
      click: follow,
      keydown(view, event) { return ['Enter', ' '].includes(event.key) ? follow(view, event) : false; },
    },
  } });
}
