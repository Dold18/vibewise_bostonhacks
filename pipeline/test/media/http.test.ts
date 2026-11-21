import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoliteFetcher } from '../../src/media/http.ts';
import { USER_AGENT } from '../../src/config.ts';

type Route = (url: string) => Response | Promise<Response>;

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

function harness(route: Route) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let clock = 0;
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return route(String(url));
  }) as typeof fetch;
  const sleep = async (ms: number) => { sleeps.push(ms); clock += ms; };
  const now = () => clock;
  return { calls, sleeps, fetcher: createPoliteFetcher({ fetchImpl, sleep, now }) };
}

const okSite: Route = (url) => (url.endsWith('/robots.txt') ? new Response('', { status: 404 }) : html('<p>hi</p>'));

test('every request carries the descriptive User-Agent', async () => {
  const h = harness(okSite);
  await h.fetcher.getText('https://a.test/', { checkRobots: true });
  assert.ok(h.calls.length > 0);
  for (const c of h.calls) assert.equal(new Headers(c.init.headers).get('user-agent'), USER_AGENT);
});

test('requests to the same host are spaced at least 1000 ms apart', async () => {
  const h = harness(okSite);
  await h.fetcher.getText('https://a.test/one');
  await h.fetcher.getText('https://a.test/two');
  assert.deepEqual(h.sleeps, [1000]);
});

test('requests to different hosts do not wait', async () => {
  const h = harness(okSite);
  await h.fetcher.getText('https://a.test/one');
  await h.fetcher.getText('https://b.test/one');
  assert.deepEqual(h.sleeps, []);
});

test('robots.txt is fetched once per origin', async () => {
  const h = harness(okSite);
  await h.fetcher.getText('https://a.test/one', { checkRobots: true });
  await h.fetcher.getText('https://a.test/two', { checkRobots: true });
  assert.equal(h.calls.filter((c) => c.url === 'https://a.test/robots.txt').length, 1);
});

test('a disallowed path is not fetched', async () => {
  const h = harness((url) => (url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /\n') : html('x')));
  const r = await h.fetcher.getText('https://a.test/about', { checkRobots: true });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'robots');
  assert.equal(h.calls.some((c) => c.url === 'https://a.test/about'), false);
});

test('a 503 on robots.txt counts as disallowed', async () => {
  const h = harness((url) => (url.endsWith('/robots.txt') ? new Response('', { status: 503 }) : html('x')));
  const r = await h.fetcher.getText('https://a.test/', { checkRobots: true });
  assert.equal(r.ok === false && r.reason, 'robots');
});

test('non-HTML content is reported as not_html', async () => {
  const h = harness(() => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }));
  const r = await h.fetcher.getText('https://a.test/menu.pdf');
  assert.equal(r.ok === false && r.reason, 'not_html');
});

test('more than 5 redirects fail with reason http', async () => {
  let n = 0;
  const h = harness(() => new Response(null, { status: 302, headers: { location: `https://a.test/r${++n}` } }));
  const r = await h.fetcher.getText('https://a.test/start');
  assert.equal(r.ok === false && r.reason, 'http');
});

test('a followed redirect returns the final URL', async () => {
  const h = harness((url) => (url === 'https://a.test/' ? new Response(null, { status: 301, headers: { location: '/home' } }) : html('<p>home</p>')));
  const r = await h.fetcher.getText('https://a.test/');
  assert.equal(r.ok && r.url, 'https://a.test/home');
  assert.equal(r.ok && r.body, '<p>home</p>');
});

test('a rejected fetch is reported as network', async () => {
  const h = harness(() => { throw new TypeError('fetch failed'); });
  const r = await h.fetcher.getText('https://a.test/');
  assert.equal(r.ok === false && r.reason, 'network');
});

test('an aborted fetch is reported as timeout', async () => {
  const h = harness(() => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
  const r = await h.fetcher.getText('https://a.test/');
  assert.equal(r.ok === false && r.reason, 'timeout');
});

test('a 404 page is reported as http', async () => {
  const h = harness(() => html('nope', 404));
  const r = await h.fetcher.getText('https://a.test/');
  assert.equal(r.ok === false && r.reason, 'http');
});

test('getJson parses JSON and throws on a non-2xx status', async () => {
  const h = harness((url) => (url.includes('bad') ? new Response('{}', { status: 500 }) : new Response('{"a":1}')));
  assert.deepEqual(await h.fetcher.getJson('https://api.test/good'), { a: 1 });
  await assert.rejects(h.fetcher.getJson('https://api.test/bad'), /500/);
});
