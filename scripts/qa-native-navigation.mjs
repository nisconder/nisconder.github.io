// Native fallback (data-astro-reload), BFCache and widget checks. The site also
// uses SPA navigation, covered by qa-search and qa-series. No dependency install.
// node scripts/qa-native-navigation.mjs --modules <existing node_modules> --url http://127.0.0.1:4328/
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const require = createRequire(resolve(option('--modules', './node_modules'), 'package.json'))
const { chromium } = require('playwright')
const base = new URL(option('--url', 'http://127.0.0.1:4328/'))
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Only local preview is allowed')
const output = resolve(import.meta.dirname, '..', '.deploy-search-performance', 'native-qa')
await mkdir(output, { recursive: true })
const catalog = JSON.parse(await readFile(new URL('../dist/search-index.json', import.meta.url), 'utf8'))
const article = catalog.find(item => item.url.includes('ics-8086-12-machine-control-flow')) ?? catalog.find(item => item.kind === '文章')
assert.ok(article)
const browser = await chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: ['--disable-back-forward-cache'] })
const report = { base: base.href, started: new Date().toISOString(), scenarios: [] }
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const searchReady = page => page.locator('[data-search-form][data-search-bound="true"]').waitFor()
const searchComplete = page => page.waitForFunction(() => document.querySelector('[data-search-status]')?.dataset.searchPhase === 'complete')
const pageId = page => page.evaluate(() => window.__qaNative.id)

const mockPlayer = `
window.__qaPlayers = [];
window.APlayer = class {
  constructor(options) {
    this.events = {}; this.destroyed = false; this.pauseCalls = 0;
    this.list = { index: 0, switch: index => { this.list.index = index; this.emit('listswitch'); } };
    this.audio = { paused: true, duration: 180, pause: () => this.pause(), removeAttribute() {}, load() {} };
    options.container.innerHTML = '<span class="aplayer-dtime">03:00</span>';
    window.__qaPlayers.push(this);
  }
  on(name, callback) { (this.events[name] ??= []).push(callback); }
  emit(name) { (this.events[name] ?? []).forEach(callback => callback()); }
  play() { this.audio.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.pauseCalls++; this.audio.paused = true; this.emit('pause'); }
  destroy() { this.destroyed = true; }
};`
const mockWaline = `export function init({el}) {
  const field = document.createElement('textarea');
  field.setAttribute('aria-label', '本地测试留言'); el.append(field);
  window.__qaWalineMounts = (window.__qaWalineMounts || 0) + 1;
  return { destroy() { field.remove(); } };
}`

async function run(name, mobile, mocked, scenario) {
  const context = await browser.newContext({
    viewport: { width: mobile ? 375 : 1440, height: mobile ? 812 : 1000 },
    isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion: 'no-preference',
  })
  await context.addInitScript(() => {
    window.__qaNative = { id: crypto.randomUUID(), shows: [] }
    window.addEventListener('pageshow', event => window.__qaNative.shows.push({ persisted: event.persisted, scroll: scrollY }))
  })
  const mockRequests = []
  const blockedWrites = []
  if (mocked) await context.route('**/*', async route => {
    const request = route.request(), target = new URL(request.url())
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blockedWrites.push({ method: request.method(), path: target.pathname })
      return route.abort('blockedbyclient')
    }
    if (target.origin === base.origin) return route.continue()
    mockRequests.push(target.href)
    const headers = { 'access-control-allow-origin': '*' }
    if (target.pathname.endsWith('/APlayer.min.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', headers, body: mockPlayer })
    if (target.pathname.endsWith('/waline.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', headers, body: mockWaline })
    if (target.pathname.endsWith('.css')) return route.fulfill({ status: 200, contentType: 'text/css', headers, body: '' })
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const result = { name, device: mobile ? 'mobile' : 'desktop', interception: mocked, status: 'passed', checks: [], errors }
  const started = Date.now()
  try {
    await scenario({ page, context, result, mockRequests })
    assert.deepEqual(errors, [], 'no uncaught page errors')
    assert.deepEqual(blockedWrites, [], 'no service writes were attempted')
  } catch (error) {
    result.status = 'failed'
    result.error = error.stack
    await page.screenshot({ path: resolve(output, `${name}-${result.device}-failure.png`) }).catch(() => {})
  } finally {
    result.elapsedMs = Date.now() - started
    result.mockRequests = mockRequests
    result.blockedWrites = blockedWrites
    report.scenarios.push(result)
    await context.close()
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ name, device: result.device, status: result.status, error: result.error?.split('\n')[0] }))
  }
}

async function historyTheme({ page, result }) {
  await page.goto(new URL(article.url, base).href, { waitUntil: 'load' })
  await page.locator('[data-reading-root][data-reading-bound="true"]').waitFor()
  const originalId = await pageId(page)
  await page.locator('[data-theme-toggle]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && !document.documentElement.hasAttribute('data-theme-transition'))
  await page.evaluate(() => scrollTo({ top: 1300, behavior: 'instant' }))
  await paint(page)
  const articleScroll = await page.evaluate(() => scrollY)
  assert.ok(articleScroll > 500)
  // A real link click dispatches browser navigation without scrolling the
  // source document back to its header and changing the restoration position.
  await page.locator('.site-search-link').evaluate(link => { link.dataset.astroReload = ''; link.click() })
  await searchReady(page)
  assert.notEqual(await pageId(page), originalId, 'navigation creates a new document')
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark')
  const searchId = await pageId(page)
  await page.locator('[data-theme-toggle]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light' && !document.documentElement.hasAttribute('data-theme-transition'))
  await page.locator('[data-search-input]').fill('unsigned')
  await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'unsigned')
  await searchComplete(page)
  const results = await page.locator('.search-result h2 a').allTextContents()
  assert.ok(results.length)
  await page.evaluate(() => scrollTo({ top: 700, behavior: 'instant' }))
  await paint(page)
  const searchScroll = await page.evaluate(() => scrollY)
  await page.goBack({ waitUntil: 'commit' })
  await page.locator('[data-reading-root]').waitFor()
  await page.waitForFunction(() => window.__qaNative.shows.at(-1)?.persisted === true)
  assert.equal(await pageId(page), originalId, 'article is restored from BFCache')
  await page.waitForFunction(expected => Math.abs(scrollY - expected) < 4, articleScroll)
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light', 'BFCache uses current saved theme')
  await page.goForward({ waitUntil: 'commit' })
  await searchReady(page)
  await page.waitForFunction(() => window.__qaNative.shows.at(-1)?.persisted === true)
  assert.equal(await pageId(page), searchId)
  assert.equal(await page.locator('[data-search-input]').inputValue(), 'unsigned')
  assert.deepEqual(await page.locator('.search-result h2 a').allTextContents(), results)
  await page.waitForFunction(expected => Math.abs(scrollY - expected) < 4, searchScroll)
  await page.locator('[data-theme-toggle]').click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  result.checks.push('new document navigation', 'actual pageshow.persisted BFCache back/forward', 'scroll restored both directions', 'theme resynchronized and control remains usable', 'search state and results retained')
  result.scroll = { article: articleScroll, search: searchScroll }
}

async function deepLink({ page, result }) {
  await page.goto(new URL(article.url, base).href, { waitUntil: 'load' })
  const anchor = await page.locator('[data-reading-body] h2[id], [data-reading-body] h3[id]').nth(1).getAttribute('id')
  assert.ok(anchor)
  await page.goto(new URL(`${article.url}#${encodeURIComponent(anchor)}`, base).href, { waitUntil: 'load' })
  await page.waitForFunction(id => {
    const top = document.getElementById(id)?.getBoundingClientRect().top
    return top >= -5 && top < 250
  }, anchor)
  const position = await page.evaluate(id => document.getElementById(id).getBoundingClientRect().top, anchor)
  assert.ok(position >= -5 && position < 250, `deep link heading visible: ${position}`)
  const menu = page.locator('[data-mobile-toc]')
  await menu.locator('summary').click()
  const target = menu.locator('[data-toc-link]').nth(2)
  const href = await target.getAttribute('href')
  await target.click()
  await page.waitForURL(url => decodeURIComponent(url.hash) === decodeURIComponent(href))
  assert.equal(await menu.getAttribute('open'), null)
  await paint(page)
  assert.ok(Number.parseInt(await page.locator('[data-reading-output]').last().innerText(), 10) > 0)
  result.checks.push('direct article hash navigation', 'mobile TOC changes native fragment and closes', 'reading progress updates')
  await page.screenshot({ path: resolve(output, 'mobile-article-deep-link.png') })
}

async function httpCache({ page, context, result }) {
  // No context.route/page.route in this scenario: interception disables cache.
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  const requestIds = new Map(), responses = [], cached = new Set(), rawStatuses = new Map()
  cdp.on('Network.requestWillBeSent', event => {
    if (new URL(event.request.url).pathname.startsWith('/search-data/')) requestIds.set(event.requestId, event.request.url)
  })
  cdp.on('Network.requestServedFromCache', event => cached.add(event.requestId))
  cdp.on('Network.responseReceivedExtraInfo', event => rawStatuses.set(event.requestId, event.statusCode))
  cdp.on('Network.responseReceived', event => {
    if (requestIds.has(event.requestId)) responses.push({ id: event.requestId, url: event.response.url, status: event.response.status, fromDiskCache: event.response.fromDiskCache, headers: event.response.headers })
  })
  await page.goto(new URL('/search/?q=IEEE754', base).href, { waitUntil: 'load' })
  await searchReady(page)
  await searchComplete(page)
  const firstId = await pageId(page)
  await page.locator('.site-brand').evaluate(link => { link.dataset.astroReload = ''; link.click() })
  await page.locator('#home-title').waitFor()
  await page.locator('.site-search-link').evaluate(link => { link.dataset.astroReload = ''; link.click() })
  await searchReady(page)
  assert.notEqual(await pageId(page), firstId, 'cache reuse is measured in a new document, not the prior module')
  await page.locator('[data-search-input]').fill('unsigned')
  await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'unsigned')
  await searchComplete(page)
  assert.ok(await page.locator('.search-result').count())
  const timing = await page.evaluate(() => performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname.startsWith('/search-data/')).map(entry => ({ url: entry.name, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize })))
  result.responses = responses.map(response => ({ ...response, servedFromCache: cached.has(response.id), rawStatus: rawStatuses.get(response.id) }))
  result.resourceTiming = timing
  const last = result.responses.at(-1)
  const reused = last?.fromDiskCache || last?.servedFromCache || last?.rawStatus === 304 || timing.some(entry => entry.transferSize === 0 && entry.decodedBodySize > 0)
  assert.ok(reused, 'the preview must serve production cache headers or ETag; full text should reuse the HTTP cache across documents')
  result.checks.push('no route interception', 'full-text HTTP cache reused across independent documents')
}

async function music({ page, result }) {
  await page.goto(new URL('/music/', base).href, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__qaPlayers?.length === 1)
  await page.locator('[data-playlist-toggle]').click()
  await page.locator('[data-track-control]').first().click()
  await page.waitForFunction(() => document.querySelector('[data-music-studio]').classList.contains('is-playing'))
  // Register after the actual player's pagehide handler. A microtask queued by
  // an earlier init-script listener can run before later native event listeners.
  await page.evaluate(() => {
    window.addEventListener('pagehide', event => {
      const player = window.__qaPlayers?.[0]
      if (player) sessionStorage.setItem('qa:native-audio', JSON.stringify({ paused: player.audio.paused, pauseCalls: player.pauseCalls, persisted: event.persisted }))
    }, { once: true })
  })
  await page.locator('.site-search-link').evaluate(link => { link.dataset.astroReload = ''; link.click() })
  await searchReady(page)
  const departure = await page.evaluate(() => JSON.parse(sessionStorage.getItem('qa:native-audio')))
  assert.equal(departure.paused, true)
  assert.ok(departure.pauseCalls >= 1)
  await page.goBack({ waitUntil: 'commit' })
  await page.waitForFunction(() => window.__qaPlayers?.length === 1)
  assert.equal(await page.locator('[data-music-studio]').evaluate(element => element.classList.contains('is-playing')), false)
  const toggle = page.locator('[data-playlist-toggle]')
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
  await page.locator('[data-track-control]').first().click()
  await page.waitForFunction(() => document.querySelector('[data-music-studio]').classList.contains('is-playing'))
  result.departure = departure
  result.checks.push('real site track control starts mock SDK playback', 'pagehide pauses audio before departure', 'back navigation does not autoplay and controls remain usable')
}

async function comments({ page, result, mockRequests }) {
  await page.goto(new URL(article.url, base).href, { waitUntil: 'load' })
  await page.locator('[data-site-comments][data-comments-bound="true"]').waitFor()
  assert.equal(await page.locator('[data-comments-toggle]').getAttribute('aria-expanded'), 'false')
  assert.equal(mockRequests.filter(url => url.includes('@waline/client')).length, 0)
  await page.locator('[data-comments-toggle]').click()
  const field = page.getByRole('textbox', { name: '本地测试留言' })
  await field.waitFor()
  await field.fill('只在本地保留，不提交')
  await page.locator('[data-comments-toggle]').click()
  await page.locator('[data-comments-body]').waitFor({ state: 'hidden' })
  await page.locator('[data-comments-toggle]').click()
  await field.waitFor()
  assert.equal(await field.inputValue(), '只在本地保留，不提交')
  assert.equal(await page.evaluate(() => window.__qaWalineMounts), 1)
  result.checks.push('mobile comments begin collapsed without CDN requests', 'open/close/reopen retains local unsent input', 'one widget mount, no writes')
  await page.screenshot({ path: resolve(output, 'mobile-comments-reopened.png') })
}

try {
  await run('history-theme', false, false, historyTheme)
  await run('history-theme', true, false, historyTheme)
  await run('deep-link', true, false, deepLink)
  await run('http-cache', false, false, httpCache)
  await run('music-pagehide', true, true, music)
  await run('comments-toggle', true, true, comments)
} finally {
  await browser.close()
  report.passed = report.scenarios.filter(item => item.status === 'passed').length
  report.failed = report.scenarios.filter(item => item.status === 'failed').length
  report.completed = new Date().toISOString()
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, report: resolve(output, 'report.json') }))
if (report.failed) process.exitCode = 1
