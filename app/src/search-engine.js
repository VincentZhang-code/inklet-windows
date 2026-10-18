export function searchText(source, query, { sensitive = false, whole = false, limit = 5000 } = {}) {
  if (!query) return { matches: [], count: 0 };
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), sensitive ? 'gu' : 'giu');
  const matches = [];
  let count = 0;
  const isWord = character => !!character && /[\p{L}\p{N}_]/u.test(character);
  let found;
  while ((found = expression.exec(source)) !== null) {
    const from = found.index;
    const to = from + found[0].length;
    if (!whole || (!isWord(source[from - 1]) && !isWord(source[to]))) {
      count++;
      if (matches.length < limit) matches.push({ from, to });
    }
  }
  return { matches, count };
}

export function groupSearchMatches(matches, headings) {
  const groups = [];
  let headingIndex = -1;
  for (const [index, match] of matches.entries()) {
    while (headingIndex + 1 < headings.length && headings[headingIndex + 1].from <= match.from) headingIndex++;
    let group = groups.at(-1);
    if (!group || group.headingIndex !== headingIndex) {
      const heading = headings[headingIndex];
      group = { headingIndex, title: heading?.text || (heading ? '未命名标题' : '文档开头'), level: heading?.level || 0, firstMatch: index, lastMatch: index, count: 0 };
      groups.push(group);
    }
    group.lastMatch = index;
    group.count++;
  }
  return groups;
}