import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots } from '../../src/media/robots.ts';
import { USER_AGENT } from '../../src/config.ts';

test('Disallow: / under * blocks every path', () => {
  const allowed = parseRobots('User-agent: *\nDisallow: /\n', USER_AGENT);
  assert.equal(allowed('/about'), false);
  assert.equal(allowed('/'), false);
});

test('a vibenta-ingest group overrides the * group', () => {
  const allowed = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: vibenta-ingest\nAllow: /\n', USER_AGENT);
  assert.equal(allowed('/about'), true);
});

test('the longest matching rule wins', () => {
  const allowed = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/menu\n', USER_AGENT);
  assert.equal(allowed('/private/menu'), true);
  assert.equal(allowed('/private/x'), false);
  assert.equal(allowed('/public'), true);
});

test('an empty file allows everything', () => {
  assert.equal(parseRobots('', USER_AGENT)('/anything'), true);
});

test('comments and an empty Disallow are ignored', () => {
  const allowed = parseRobots('# hi\nUser-agent: * # all\nDisallow:\n', USER_AGENT);
  assert.equal(allowed('/x'), true);
});
