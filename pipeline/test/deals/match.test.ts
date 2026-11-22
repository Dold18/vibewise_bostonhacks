import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractLines, matchDeals, type PageLine } from '../../src/deals/match.ts';

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const URL_ = 'https://venue.example/';
const AT = '2026-11-21T12:00:00.000Z';
const plain = (...texts: string[]): PageLine[] => texts.map((text) => ({ text, link: false }));

test('specials.html yields the five expected deals in page order', () => {
  const rows = matchDeals(extractLines(fixture('specials.html')), URL_, AT);
  assert.deepEqual(
    rows.map((r) => [r.kind, r.timing, r.title]),
    [
      ['student', 'any_time', '10% off with student ID'],
      ['student', 'unconfirmed', 'Student night Wednesdays: $5 off'],
      ['student', 'scheduled', 'Show your college ID for 15% off Mon-Fri 2-5pm'],
      ['special', 'scheduled', 'Happy Hour · Monday–Friday 3–6pm'],
      ['special', 'unconfirmed', 'Tuesday specials'],
    ],
  );
  assert.deepEqual(rows[2]!.schedule, [{ days: [1, 2, 3, 4, 5], start: '14:00', end: '17:00' }]);
  assert.deepEqual(rows[3]!.schedule, [{ days: [1, 2, 3, 4, 5], start: '15:00', end: '18:00' }]);
  assert.equal(rows[0]!.schedule, null);
  for (const r of rows) {
    assert.equal(r.source, 'website');
    assert.equal(r.sourceUrl, URL_);
    assert.equal(r.checkedAt, AT);
  }
});

test('nav-only.html gives no deals', () => {
  assert.deepEqual(matchDeals(extractLines(fixture('nav-only.html')), URL_, AT), []);
});

test('script text never matches', () => {
  const lines = extractLines(fixture('specials.html'));
  assert.ok(!lines.some((l) => /1-2pm/.test(l.text)));
});

test('extractLines flags whole-link lines and splits sentences and br', () => {
  const lines = extractLines('<body><p>Hello there. Second one!<br>Third <a href="/x">Click</a> end</p></body>');
  assert.deepEqual(lines, [
    { text: 'Hello there.', link: false },
    { text: 'Second one!', link: false },
    { text: 'Third', link: false },
    { text: 'Click', link: true },
    { text: 'end', link: false },
  ]);
});

test('long lines get a 120-char title ending in an ellipsis and a 200-char quote', () => {
  const line = `10% off for everyone ${'word '.repeat(60)}`.trim();
  assert.ok(line.length >= 300);
  const [row] = matchDeals(plain(line), URL_, AT);
  assert.ok(row!.title.length <= 120);
  assert.ok(row!.title.endsWith('…'));
  assert.ok(row!.quote!.length <= 200);
});

test('caps at 5 and de-duplicates by title', () => {
  const seven = plain(...Array.from({ length: 7 }, (_, i) => `${i + 1}0% off item ${i}`));
  assert.equal(matchDeals(seven, URL_, AT).length, 5);
  assert.equal(matchDeals(plain('10% off', '10% off', '10% OFF'), URL_, AT).length, 1);
});

test('link lines never produce deals', () => {
  assert.deepEqual(matchDeals([{ text: '10% off with student ID', link: true }], URL_, AT), []);
});

test('a neighbouring deal schedule does not leak onto a line', () => {
  const rows = matchDeals(plain('Happy Hour', '10% off Mon-Fri 2-5pm'), URL_, AT);
  assert.equal(rows[0]!.timing, 'unconfirmed');
  assert.equal(rows.length, 2);
});

test('a timing word on the next line downgrades student any_time to unconfirmed', () => {
  const rows = matchDeals(plain('10% off with student ID', 'Valid Tuesdays only.'), URL_, AT);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.kind, 'student');
  assert.equal(rows[0]!.timing, 'unconfirmed');
  assert.equal(rows[0]!.schedule, null);
});

test('opening hours are never joined onto a deal', () => {
  const a = matchDeals(plain('Happy Hour', 'Open Mon–Sat 11am–10pm'), URL_, AT);
  assert.equal(a.length, 1);
  assert.equal(a[0]!.title, 'Happy Hour');
  assert.equal(a[0]!.timing, 'unconfirmed');
  const b = matchDeals(plain('Tuesday specials', 'Kitchen hours Mon-Fri 11-9pm'), URL_, AT);
  assert.equal(b.length, 1);
  assert.equal(b[0]!.title, 'Tuesday specials');
  assert.equal(b[0]!.timing, 'unconfirmed');
  assert.equal(b[0]!.schedule, null);
});
