import { parse, HTMLElement, type Node } from 'node-html-parser';
import { hasTimingWords, parseSchedule, timingFor } from './schedule.ts';
import type { DealKind, DealRow } from './types.ts';

export interface PageLine {
  text: string;
  /** True when the line is the whole text of an `a` or `button` element. */
  link: boolean;
}

export const STUDENT_TERM = /\bstudents?\b|\bcollege\s+id\b|\bschool\s+id\b|\.edu\b/i;
export const DISCOUNT_TERM = /\d+\s?% off|\$\d+ off|\bdiscount|\bfree\b|half[- ]price|\bdeals?\b/i;
export const SPECIAL_TERM =
  /\bhappy[\s-]?hour\b|half[- ]price|\d+\s?% off|\bbogo\b|\bbuy one,? get one\b|\b(?:sun|mon|tue(?:s)?|wed(?:nes)?|thu(?:r(?:s)?)?|fri|sat(?:ur)?)(?:day)?s?\s+specials?\b/i;

/** A concrete offer; without one a student line is listed but never gets a standing (any_time) chip. */
const CONCRETE_OFFER =
  /\d+\s?% off|\$\d+(?:\.\d\d)? off|half[- ]price|\bfree\b[^.]*?\bwith\s+(?:a\s+)?(?:valid\s+)?(?:student|college|school)\s+id\b|\bstudent\s+(?:discount|price|pricing|rate)s?\b/i;

const OPENING_HOURS = /\b(open|opens|opening|hours|kitchen|closed|dining|serving)\b/i;
const MAX_DEALS = 5;
const MAX_TITLE = 120;
const MAX_QUOTE = 200;
const REMOVED = 'script, style, noscript, template, svg';
const BLOCKS = new Set([
  'p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article',
  'header', 'footer', 'nav', 'td', 'tr', 'br',
  'th', 'dt', 'dd', 'dl', 'ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'main', 'aside',
  'blockquote', 'figure', 'figcaption', 'form', 'address', 'pre', 'hr',
]);
const LINKS = new Set(['a', 'button']);

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function extractLines(html: string): PageLine[] {
  const root = parse(html);
  root.querySelectorAll(REMOVED).forEach((el) => el.remove());
  const body = root.querySelector('body') ?? root;

  const lines: PageLine[] = [];
  let buf = '';
  const flush = () => {
    const text = collapse(buf);
    buf = '';
    if (!text) return;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (sentence) lines.push({ text: sentence, link: false });
    }
  };
  const walk = (node: Node) => {
    if (!(node instanceof HTMLElement)) {
      buf += node.text;
      return;
    }
    const tag = node.tagName?.toLowerCase();
    if (tag && LINKS.has(tag)) {
      flush();
      const text = collapse(node.text);
      if (text) lines.push({ text, link: true });
      return;
    }
    const block = tag !== undefined && BLOCKS.has(tag);
    if (block) flush();
    node.childNodes.forEach(walk);
    if (block) flush();
  };
  walk(body);
  flush();
  return lines;
}

function cutTitle(text: string): string {
  if (text.length <= MAX_TITLE) return text;
  const cut = text.slice(0, MAX_TITLE - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const hasDealTerm = (text: string) =>
  STUDENT_TERM.test(text) || DISCOUNT_TERM.test(text) || SPECIAL_TERM.test(text);

function kindOf(text: string): DealKind | null {
  if (STUDENT_TERM.test(text) && DISCOUNT_TERM.test(text)) return 'student';
  if (SPECIAL_TERM.test(text)) return 'special';
  return null;
}

export function matchDeals(lines: PageLine[], pageUrl: string, checkedAt: string): DealRow[] {
  const rows: DealRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length && rows.length < MAX_DEALS; i++) {
    const line = lines[i]!;
    if (line.link) continue;
    const kind = kindOf(line.text);
    if (!kind) continue;

    let text = line.text;
    let quote = line.text;
    const next = parseSchedule(text) ? undefined : lines.slice(i + 1).find((l) => !l.link);
    if (
      next &&
      parseSchedule(next.text) &&
      !hasDealTerm(next.text) &&
      !OPENING_HOURS.test(next.text)
    ) {
      text = `${line.text} · ${next.text}`;
      quote = `${line.text} ${next.text}`;
    }

    const title = cutTitle(text);
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let { timing, schedule } = timingFor(kind, text);
    // The next line may only downgrade any_time (spec 4.3); it never adds a schedule.
    if (timing === 'any_time' && next && hasTimingWords(next.text)) timing = 'unconfirmed';
    if (timing === 'any_time' && !CONCRETE_OFFER.test(line.text)) timing = 'unconfirmed';
    rows.push({
      kind,
      title,
      quote: quote.slice(0, MAX_QUOTE),
      timing,
      schedule,
      source: 'website',
      sourceUrl: pageUrl,
      checkedAt,
    });
  }
  return rows;
}
