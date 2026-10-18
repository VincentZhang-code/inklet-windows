import { common, createLowlight } from 'lowlight';

const highlighter = createLowlight(common);

export function highlightCode(text, language) {
  if (!highlighter.registered(language)) return [];
  const spans = [];
  let offset = 0;
  const visit = (node, classes = []) => {
    if (node.type === 'text') {
      const from = offset;
      offset += node.value.length;
      if (offset > from && classes.length) spans.push({ from, to: offset, className: classes.join(' ') });
    } else {
      const nextClasses = [...classes, ...(node.properties?.className || [])];
      for (const child of node.children || []) visit(child, nextClasses);
    }
  };
  visit(highlighter.highlight(language, text));
  return spans;
}