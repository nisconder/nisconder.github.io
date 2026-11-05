import test from 'node:test'
import assert from 'node:assert/strict'
import {
  publicNavigationKey, canPrefetch, parseNavigationHtml,
  createNavigationCache, installCachedNavigationLoader,
} from '../../src/lib/navigation-cache.mjs'

const origin = 'https://blog.test'
const article = '/2026/11/05/ics-note/'
const response = (path, overrides = {}) => ({
  status: 200, redirected: false, url: new URL(path, origin).href,
  headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
  text: async () => path, ...overrides,
})
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('allowlist retains query, removes fragment and excludes private or external routes', () => {
  for (const path of ['/search/', '/articles', '/series/', '/series/ics-8086/', article]) {
    assert.equal(publicNavigationKey(`${path}?q=word#heading`, origin), `${origin}${path}?q=word`)
  }
  for (const path of ['/admin/', '/admin/content/', '/', '/music/', '/series/a/b/',
    '/2026/11/05/a%2F..%2Fadmin/', '/2026/11/05/a%5Cb/', 'https://elsewhere.test/search/',
    'https://user:pass@blog.test/search/', 'javascript:alert(1)', '/search/extra/', '/series/%ZZ/']) {
    assert.equal(publicNavigationKey(path, origin), null, path)
  }
})

test('background, prerender, save-data and 2g pages cannot start speculation', () => {
  assert.equal(canPrefetch({ visibilityState: 'visible' }), true)
  assert.equal(canPrefetch({ visibilityState: 'hidden' }), false)
  assert.equal(canPrefetch({ visibilityState: 'visible', prerendering: true }), false)
  for (const connection of [{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
    assert.equal(canPrefetch({ visibilityState: 'visible' }, connection), false)
  }
})

test('parser requires Astro, removes noscript and leaves stylesheet pages to default loader', () => {
  let removed = 0
  const document = {
    querySelector: () => ({}), head: { querySelector: () => null },
    querySelectorAll: () => [{ remove: () => { removed += 1 } }],
  }
  class Parser { parseFromString(html, type) { assert.equal(type, 'text/html'); return document } }
  assert.equal(parseNavigationHtml('html', Parser), document)
  assert.equal(removed, 1)
  document.head.querySelector = () => ({})
  assert.equal(parseNavigationHtml('html', Parser), null)
  document.head.querySelector = () => null
  document.querySelector = () => null
  assert.equal(parseNavigationHtml('html', Parser), null)
})

test('in-flight intents share one request and consumed documents are never reused', async () => {
  const pending = deferred()
  let calls = 0
  const cache = createNavigationCache({ origin, fetch: () => { calls += 1; return pending.promise }, parse: (html) => ({ html }) })
  const first = cache.prefetch(article)
  assert.equal(cache.prefetch(`${article}#heading`), first)
  const navigation = cache.consume(article)
  pending.resolve(response(article))
  assert.deepEqual(await navigation, { html: article })
  assert.equal(await cache.consume(article), null)
  assert.equal(calls, 1)
})

test('cache caps both pending and ready entries at three and expires after 60 seconds', async () => {
  let clock = 0
  const signals = []
  const pending = deferred()
  const cache = createNavigationCache({ origin, now: () => clock,
    fetch: (url, options) => { signals.push(options.signal); return signals.length === 1 ? pending.promise : Promise.resolve(response(url)) },
    parse: (html) => ({ html }),
  })
  const old = cache.prefetch(article)
  await cache.prefetch('/search/')
  await cache.prefetch('/articles/')
  await cache.prefetch('/series/')
  assert.equal(signals[0].aborted, true)
  pending.resolve(response(article))
  assert.equal(await old, null)
  assert.equal(await cache.consume(article), null)
  clock = 60_000
  assert.equal(await cache.consume('/search/'), null)
  assert.equal(await cache.consume('/series/'), null)
})

test('invalid responses and parser failures are never cached and can retry', async () => {
  const invalid = [
    { status: 404 }, { status: 302 }, { redirected: true }, { url: 'https://elsewhere.test/search/' },
    { url: `${origin}/articles/` }, { headers: new Headers({ 'content-type': 'application/json' }) },
  ]
  for (const overrides of invalid) {
    const cache = createNavigationCache({ origin, fetch: async () => response('/search/', overrides), parse: () => ({}) })
    assert.equal(await cache.prefetch('/search/'), null)
    assert.equal(await cache.consume('/search/'), null)
  }
  let attempts = 0
  const cache = createNavigationCache({ origin, fetch: async () => response('/search/'),
    parse: () => { if (!attempts++) throw new Error('parse failure'); return { valid: true } },
  })
  assert.equal(await cache.prefetch('/search/'), null)
  assert.deepEqual(await cache.prefetch('/search/'), { valid: true })
})

test('navigation abort cancels a shared request promptly and cannot install its late response', async () => {
  const pending = deferred()
  let requestSignal
  const cache = createNavigationCache({ origin, fetch: (_url, options) => {
    requestSignal = options.signal
    return pending.promise
  }, parse: () => ({ valid: true }) })
  const prefetch = cache.prefetch(article)
  const controller = new AbortController()
  const navigation = cache.consume(article, controller.signal)
  controller.abort()
  assert.equal(await navigation, null)
  assert.equal(requestSignal.aborted, true)
  pending.resolve(response(article))
  assert.equal(await prefetch, null)
  assert.equal(await cache.consume(article), null)
})

test('official loader hook preserves target fragment, falls back on miss and skips forms/aborts', async () => {
  const document = new EventTarget()
  let fallbacks = 0
  const loaded = { title: 'cached' }
  const cache = { consume: async () => loaded }
  const cleanup = installCachedNavigationLoader(document, cache)
  const prepare = (overrides = {}) => {
    const event = new Event('astro:before-preparation', { cancelable: true })
    Object.assign(event, { to: new URL(`${article}#heading`, origin),
      signal: new AbortController().signal, loader: async () => { fallbacks += 1 }, ...overrides })
    document.dispatchEvent(event)
    return event
  }
  const hit = prepare()
  await hit.loader()
  assert.equal(hit.newDocument, loaded)
  assert.equal(hit.to.hash, '#heading')
  assert.equal(fallbacks, 0)
  cache.consume = async () => null
  await prepare().loader()
  assert.equal(fallbacks, 1)
  cache.consume = async () => { throw new Error('failed') }
  await prepare().loader()
  assert.equal(fallbacks, 2)
  await prepare({ formData: {} }).loader()
  assert.equal(fallbacks, 3)
  const controller = new AbortController()
  controller.abort()
  await prepare({ signal: controller.signal }).loader()
  assert.equal(fallbacks, 3)
  cleanup()
})
