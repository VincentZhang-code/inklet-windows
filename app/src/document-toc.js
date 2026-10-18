export function renderTableOfContents(element, headings) {
  const document = element.ownerDocument;
  const list = document.createElement('ol');
  list.className = 'document-toc-list';
  const firstLevel = Math.min(6, ...headings.map(heading => heading.level));
  for (const [index, heading] of headings.entries()) {
    const item = document.createElement('li');
    item.style.marginInlineStart = Math.max(0, heading.level - firstLevel) * 18 + 'px';
    item.dataset.level = heading.level;
    const link = document.createElement('a');
    link.href = '#' + heading.id;
    link.dataset.headingId = heading.id;
    link.dataset.headingIndex = index;
    link.textContent = heading.text;
    item.append(link);
    list.append(item);
  }
  element.replaceChildren(list);
}

export function headingIntent(headings, index) {
  const heading = headings[index];
  if (!heading) return null;
  const occurrence = headings.slice(0, index).filter(item => item.text === heading.text && item.level === heading.level).length;
  return { text: heading.text, level: heading.level, occurrence, index };
}

export function resolveHeadingIntent(headings, intent) {
  if (!intent) return null;
  const matches = headings.filter(heading => heading.text === intent.text && heading.level === intent.level);
  return matches[intent.occurrence] || headings[intent.index] || null;
}