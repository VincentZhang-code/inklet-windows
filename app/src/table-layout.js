import { TableMap } from 'prosemirror-tables';

const profiles = new WeakMap();

function textUnits(text) {
  let total = 0;
  for (const character of text) total += /[\u2e80-\u9fff\uac00-\ud7af\uff01-\uff60]/u.test(character) ? 1 : /\s/u.test(character) ? .3 : .56;
  return total;
}

function quantile(values, fraction) {
  const position = (values.length - 1) * fraction;
  const lower = Math.floor(position);
  return values.length ? values[lower] + (values[Math.ceil(position)] - values[lower]) * (position - lower) : 0;
}

function profile(table) {
  if (profiles.has(table)) return profiles.get(table);
  const map = TableMap.get(table);
  const columns = Array.from({ length: map.width }, () => ({ lengths: [], tokens: [], header: 0, fixed: null }));
  const seen = new Set();
  for (let index = 0; index < map.map.length; index++) {
    const position = map.map[index];
    if (seen.has(position)) continue;
    seen.add(position);
    const cell = table.nodeAt(position);
    if (!cell) continue;
    const first = index % map.width;
    const span = cell.attrs.colspan || 1;
    const text = cell.textContent.trim();
    const units = /^(?:-|—|–|n\/a|null)?$/i.test(text) ? 0 : textUnits(text) / span;
    const token = Math.min(24, text.split(/[\s/;,:，。；、|]+/u).reduce((maximum, word) => Math.max(maximum, textUnits(word)), 0)) / span;
    for (let offset = 0; offset < span; offset++) {
      const column = columns[first + offset];
      if (!column) continue;
      if (index < map.width && cell.type.name === 'table_header') column.header = Math.max(column.header, units);
      else { column.lengths.push(Math.min(units, 160)); column.tokens.push(units ? token : 0); }
      if (cell.attrs.colwidth?.[offset]) column.fixed = cell.attrs.colwidth[offset];
    }
  }
  const result = columns.map(column => {
    const lengths = column.lengths.sort((left, right) => left - right);
    const upper = quantile(lengths, .75);
    const cutoff = Math.max(8, upper * 2);
    const average = lengths.reduce((sum, length) => sum + Math.min(length, cutoff), 0) / Math.max(1, lengths.length);
    const typical = average * .5 + quantile(lengths, .5) * .25 + upper * .25;
    const frequent = lengths.filter(length => length >= 12).length / Math.max(1, lengths.length);
    return { header: column.header, fixed: column.fixed, typical, frequent, token: quantile(column.tokens.sort((left, right) => left - right), .5) };
  });
  profiles.set(table, result);
  return result;
}

export function tableColumnWidths(table, availableWidth = 720, fontSize = 14) {
  const columns = profile(table);
  if (!columns.length) return [];
  const minimums = columns.map(column => column.fixed || Math.max(58, 24 + Math.max(Math.min(column.header, 8), Math.min(column.token, 5), Math.min(12, Math.sqrt(column.typical) * (1 + .45 * column.frequent))) * fontSize));
  const preferred = columns.map((column, index) => column.fixed || Math.max(minimums[index], 24 + Math.min(34, Math.max(Math.min(column.header, 12), column.token, Math.sqrt(column.typical) * (2.6 + 1.1 * column.frequent))) * fontSize));
  const minimumTotal = minimums.reduce((sum, width) => sum + width, 0);
  const target = Math.max(minimumTotal, Number.isFinite(availableWidth) ? availableWidth : 720);
  let remaining = target - minimumTotal;
  const widths = minimums.slice();
  const demands = preferred.map((width, index) => columns[index].fixed ? 0 : width - minimums[index]);
  const demandTotal = demands.reduce((sum, width) => sum + width, 0);
  if (demandTotal > 0) {
    const allotted = Math.min(remaining, demandTotal);
    for (let index = 0; index < widths.length; index++) widths[index] += allotted * demands[index] / demandTotal;
    remaining -= allotted;
  }
  const flexible = columns.map((column, index) => column.fixed ? 0 : preferred[index]);
  const flexibleTotal = flexible.reduce((sum, width) => sum + width, 0);
  if (remaining > 0 && flexibleTotal > 0) for (let index = 0; index < widths.length; index++) widths[index] += remaining * flexible[index] / flexibleTotal;
  return widths.map(width => Math.round(width));
}