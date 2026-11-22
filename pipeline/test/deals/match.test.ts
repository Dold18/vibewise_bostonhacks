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
  assert.equal(matchDeals(plain('10% off lunch', '10% off lunch', '10% OFF LUNCH'), URL_, AT).length, 1);
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

test('F3: vague student lines are listed but unconfirmed; concrete offers stay any_time', () => {
  for (const line of [
    'Free Wi-Fi - a great spot for students to study',
    'Great deals for students!',
    'Now hiring students! Free shift meals',
  ]) {
    const [row] = matchDeals(plain(line), URL_, AT);
    assert.equal(row!.kind, 'student', line);
    assert.equal(row!.timing, 'unconfirmed', line);
  }
  for (const line of ['10% off with student ID', 'Free coffee with valid student ID', 'Student discount available']) {
    assert.equal(matchDeals(plain(line), URL_, AT)[0]!.timing, 'any_time', line);
  }
});

test('F4: definition lists and table headers do not merge text across blocks', () => {
  const dl = '<body><dl><dt>Students welcome</dt><dd>Free parking</dd></dl></body>';
  assert.deepEqual(matchDeals(extractLines(dl), URL_, AT), []);
  const th = '<body><table><tr><th>Student ID</th><th>10% off</th></tr></table></body>';
  assert.deepEqual(extractLines(th).map((l) => l.text), ['Student ID', '10% off']);
});

test('F10: quote of a joined deal is the raw source text without the separator', () => {
  const [row] = matchDeals(plain('Happy Hour', 'Monday–Friday 3–6pm'), URL_, AT);
  assert.equal(row!.title, 'Happy Hour · Monday–Friday 3–6pm');
  assert.equal(row!.quote, 'Happy Hour Monday–Friday 3–6pm');
});

test('F11: offers that are not for a walk-in visit are skipped', () => {
  for (const line of [
    '10% off your first online order',
    'Register and get 20% off first online order.',
    'Get 15% off your catering order!',
    'Catering discounts available for student groups',
    'GET 15% OFF ON ANY Order after $45 or more',
    '5% Off All Orders',
    'Use code FEAST20 for 20% off lane reservations.',
    '15% off code has been applied.',
    'Get 10% off your first purchase when you sign up for our newsletter!',
    'HOLIDAY GIFT CARD BOGO',
    'BOGO 50% OFF ALL COFFEE BAGS',
    'Variety packs are 20% off + free shipping.',
    '20% off sitewide this weekend',
    'BOGO Delivery: buy one, get one free on select meals through delivery apps.',
    'Download the app and get 20% off.',
    "Don't leave without your 10% off coupon*",
    'Take 20% off your stay',
    'Book a suite and receive up to 20% off.',
    'Or, get 10% off 1 night with your everyday hotel discount.',
    '*Up to 25% off',
    'Black Friday Sale: 70% off all custom frames',
    'Enjoy 47% Off Everything – Hurry Before It’s Gone!',
    '15% Off All Footage Products',
    'Valid for 10% off orders at participating locations',
    'Cheese with games and food deals for as little as $7.99 a month!',
    '21% off',
  ]) {
    assert.deepEqual(matchDeals(plain(line), URL_, AT), [], line);
  }
});

test('F12: offers limited to a non-student group are skipped unless students are named', () => {
  for (const line of [
    'Cardholders get 50% off handcrafted beverages every day.',
    'Check out with Paze and GET 35% off.',
    'Get 5% OFF when you pay with CASH',
    'Get 15% OFF for FIRST responders',
    'Military members ride for 50% off Monday–Friday.',
    'Seniors enjoy up to 20% off',
    'AARP Members Enjoy 15% Off',
    'Library pass holders receive 40% off admission.',
    'Show a valid ID or employee badge at lunch and take 10% off.',
    'Enjoy 15% OFF your food purchase as a reward for all your hard work.',
  ]) {
    assert.deepEqual(matchDeals(plain(line), URL_, AT), [], line);
  }
  const [row] = matchDeals(plain('Tour tickets are $2 off for students, senior citizens and active military.'), URL_, AT);
  assert.equal(row!.kind, 'student');
});

test('F13: lines that mention a deal word without offering one are skipped', () => {
  for (const line of [
    'What’s better than one happy hour?',
    '10% Off Lobster!?',
    'While we do not have a Happy Hour menu at our bar, our cocktails are great.',
    'Thursday Special Hours Closed',
    'They have a discount for Tufts students!',
    'The service was very nice, and they also give a student 10% discount which was nice!',
    'Good For Happy Hour',
    'Our dining rooms are perfect for private dining, corporate events and receptions, plus happy hour.',
    'Dine-in | Take out | Catering | Lunch Specials | Sunday Specials |',
    ', a writer said the bar is vibrant enough for a happy hour pop-in',
    'Note: all customers paying happy hour price must order before 6pm',
    'All student programs and class visits are free of charge.',
    'Bring local middle and high school students to the show for free.',
    'The school is free to students, offering shuttle services between campuses.',
    'Picky eaters, vegetarians, gluten-free guests, kids and students can all build a bowl.',
    'Get Unlock 15% OFF Instantly When You Buy 5+ TOGEL ONLINE',
  ]) {
    assert.deepEqual(matchDeals(plain(line), URL_, AT), [], line);
  }
});

test('F14: real in-venue specials and student discounts still match', () => {
  for (const [line, kind] of [
    ['Show your college ID and get 20% off your meal.', 'student'],
    ['Students who attend college in New England may show their college ID for a discount.', 'student'],
    ['Our student and teacher discount is valid for members of the teachers union and college students.', 'student'],
    ['Show your show ticket and get 20% off your food order.', 'special'],
    ['Get 10% off your game play purchase when you buy any food & drink combo in-store.', 'special'],
    ['Enjoy our buy one, get one free sushi special with any roll of equal or lesser value.', 'special'],
    ['Happy Hour | 2pm – 7pm | Monday – Friday', 'special'],
    ['(extended happy hour 2pm-6pm)', 'special'],
    ['Happy Hour applies to all ages here!', 'special'],
    ['Sipping on discounted drinks during Happy Hour, or planning a party with us.', 'special'],
    ['On the first and second Sundays, students get free admission with up to two guests.', 'student'],
  ] as const) {
    const rows = matchDeals(plain(line), URL_, AT);
    assert.equal(rows.length, 1, line);
    assert.equal(rows[0]!.kind, kind, line);
  }
});
