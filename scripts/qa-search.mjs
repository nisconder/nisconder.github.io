// Real Chromium UI regression. Each scenario starts with a cold browser context.
// node scripts/qa-search.mjs --modules <existing node_modules> --url http://127.0.0.1:4328/
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const require = createRequire(resolve(option('--modules', './node_modules'), 'package.json'))
const { chromium } = require('playwright')
const base = new URL(option('--url', 'http://127.0.0.1:4328/'))
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Use a loopback build preview')
const output = resolve(import.meta.dirname, '..', '.deploy-search-performance', 'functional')
await mkdir(output, { recursive: true })
const records = JSON.parse(await readFile(new URL('../dist/search-index.json', import.meta.url), 'utf8'))
const normalise = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN')
const metadata = item => [item.title, item.description, item.category, ...(item.tags ?? [])].join(' ')
const includesQuery = (item, query) => normalise(query).split(/\s+/).filter(Boolean)
  .every(token => normalise(`${metadata(item)} ${item.content ?? ''}`).includes(token))
const expectedURLs = (query, kind) => records.filter(item => (!kind || item.kind === kind) && includesQuery(item, query)).map(item => item.url)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = { base: base.href, started: new Date().toISOString(), scenarios: [] }
const inputSelector = '[data-search-input]'
const resultsSelector = '[data-search-results] .search-result h2 a'
const phase = (page, expected) => page.waitForFunction(expected => document.querySelector('[data-search-status]')?.dataset.searchPhase === expected, expected)
const paint = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const urls = page => page.locator(resultsSelector).evaluateAll(links => links.map(link => link.getAttribute('href')))
const statusText = page => page.locator('[data-search-status]').innerText()
const ready = page => page.locator('[data-search-form][data-search-bound="true"]').waitFor()
async function visit(page, path) {
  await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' })
  await ready(page)
}
async function query(page, value) {
  await page.locator(inputSelector).fill(value)
  await page.waitForFunction(value => new URL(location.href).searchParams.get('q') === (value || null), value)
  await phase(page, 'complete')
}
async function assertQuery(page, value, kind) {
  const shown = await urls(page)
  const expected = expectedURLs(value, kind)
  assert.equal(shown.length, Math.min(20, expected.length), `query ${value}: result count`)
  assert.ok(shown.every(url => expected.includes(url)), `query ${value}: every result matches all tokens`)
  return shown
}

async function run(name, mobile, scenario) {
  const context = await browser.newContext({
    viewport: { width: mobile ? 375 : 1440, height: mobile ? 812 : 1000 },
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference', serviceWorkers: 'block',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const errors = []
  const fullRequests = []
  let fullFinished = 0
  let interception = async route => route.continue()
  let release
  page.on('pageerror', error => errors.push(error.message))
  page.on('requestfinished', request => { if (new URL(request.url()).pathname.startsWith('/search-data/')) fullFinished++ })
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort('blockedbyclient')
    if (url.origin !== base.origin) return route.abort('blockedbyclient')
    if (url.pathname.startsWith('/search-data/')) {
      fullRequests.push(url.pathname)
      return interception(route)
    }
    return route.continue()
  })
  const api = {
    page, context, fullRequests,
    get fullFinished() { return fullFinished },
    hold() {
      const gate = new Promise(resolve => { release = resolve })
      interception = async route => { await gate; await route.continue().catch(() => {}) }
      return () => release()
    },
    failFirst(code) {
      interception = route => fullRequests.length === 1
        ? route.fulfill({ status: code, contentType: 'application/json', body: '{"error":"QA controlled failure"}' })
        : route.continue()
    },
    screenshot: suffix => page.screenshot({ path: resolve(output, `${mobile ? 'mobile' : 'desktop'}-${name}${suffix ? `-${suffix}` : ''}.png`) }),
  }
  const result = { name, device: mobile ? 'mobile' : 'desktop', status: 'passed', checks: [] }
  const start = Date.now()
  try {
    await scenario(api, result.checks)
    assert.deepEqual(errors, [], 'no uncaught browser errors')
  } catch (error) {
    result.status = 'failed'
    result.error = error.stack
    await api.screenshot('failure').catch(() => {})
  } finally {
    release?.()
    result.elapsedMs = Date.now() - start
    result.fullRequests = fullRequests
    result.errors = errors
    report.scenarios.push(result)
    await context.close()
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify({ name, device: result.device, status: result.status, requests: fullRequests.length, error: result.error?.split('\n')[0] }))
  }
}

const scenarios = {
  async compact(api, checks) {
    const release = api.hold()
    await visit(api.page, '/search/?q=8086')
    await phase(api.page, 'partial')
    assert.ok((await urls(api.page)).length > 0, 'metadata results are visible before full text responds')
    assert.match(await statusText(api.page), /继续检索正文/)
    assert.equal(api.fullRequests.length, 1)
    await api.screenshot('pending')
    release()
    await phase(api.page, 'complete')
    await assertQuery(api.page, '8086')
    checks.push('compact results render while full-text request is held', 'full-text completion retains matches')
  },
  async language(api, checks) {
    await visit(api.page, '/search/')
    for (const value of ['寄存器', '8086 寄存器', 'IEEE754', 'unsigned']) {
      await query(api.page, value)
      const shown = await assertQuery(api.page, value)
      assert.ok(shown.length, `${value} has real matching content`)
    }
    for (const value of ['IEEE754', 'unsigned']) assert.ok(!records.some(item => normalise(metadata(item)).includes(normalise(value))), `${value} is a body-only fixture`)
    await query(api.page, '8086')
    const halfWidth = await urls(api.page)
    await query(api.page, '８０８６')
    assert.deepEqual(await urls(api.page), halfWidth)
    await query(api.page, '8086 zzz-no-real-phrase-024601')
    assert.deepEqual(await urls(api.page), [])
    await api.page.locator('.search-empty-link').waitFor()
    assert.equal(api.fullRequests.length, 1)
    checks.push('Chinese and NFKC full-width matching', 'AND tokens reject a nonmatching second word', 'body-only IEEE754 and unsigned preserved', 'one shared full-text request')
  },
  async filters(api, checks) {
    await visit(api.page, '/search/?type=series')
    await phase(api.page, 'complete')
    assert.equal((await urls(api.page)).length, records.filter(item => item.kind === '合集').length)
    assert.ok((await api.page.locator('.search-result__meta').allTextContents()).every(text => text.startsWith('合集')))
    const category = await api.page.locator('[data-category]:not([data-category=""])').first().getAttribute('data-category')
    await api.page.locator('[data-category]:not([data-category=""])').first().click()
    await phase(api.page, 'complete')
    assert.equal((await urls(api.page)).length, Math.min(20, records.filter(item => item.kind === '文章' && item.category === category).length))
    await api.page.locator('[data-category=""]').click()
    await phase(api.page, 'complete')
    assert.ok((await api.page.locator('.search-result__meta').allTextContents()).every(text => text.startsWith('文章')))
    await paint(api.page)
    assert.equal(api.fullRequests.length, 0, 'type/category-only views do not download full text')
    checks.push('type-only and category-only results render locally', 'article All filter never includes projects or series', 'zero full-text requests')
  },
  async ime(api, checks) {
    await visit(api.page, '/search/')
    const before = { url: api.page.url(), status: await statusText(api.page), results: await urls(api.page) }
    await api.page.locator(inputSelector).focus()
    await api.page.locator(inputSelector).evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
      input.value = '寄存器'
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: '寄存器', isComposing: true }))
      input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '寄存器' }))
    })
    await paint(api.page)
    assert.equal(api.page.url(), before.url)
    assert.equal(await statusText(api.page), before.status)
    assert.deepEqual(await urls(api.page), before.results)
    assert.equal(api.fullRequests.length, 0)
    await api.page.locator(inputSelector).dispatchEvent('compositionend', { data: '寄存器' })
    await api.page.waitForFunction(() => new URL(location.href).searchParams.get('q') === '寄存器')
    await phase(api.page, 'complete')
    await assertQuery(api.page, '寄存器')
    await api.screenshot('committed')
    checks.push('composition updates leave URL/results untouched', 'compositionend commits Chinese search')
  },
  async stale(api, checks) {
    const release = api.hold()
    await visit(api.page, '/search/?q=IEEE754')
    await phase(api.page, 'partial')
    await api.page.locator(inputSelector).fill('unsigned')
    await api.page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'unsigned')
    release()
    await phase(api.page, 'complete')
    await assertQuery(api.page, 'unsigned')
    assert.match(await statusText(api.page), /unsigned/)
    assert.doesNotMatch(await statusText(api.page), /IEEE754/)
    assert.equal(api.fullRequests.length, 1)
    checks.push('new query owns delayed response', 'concurrent queries share a single full-text request')
  },
  async cleared(api, checks) {
    const release = api.hold()
    await visit(api.page, '/search/?q=IEEE754')
    await phase(api.page, 'partial')
    await query(api.page, '')
    release()
    await api.page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/search-data/'))
    await paint(api.page)
    assert.deepEqual(await urls(api.page), [])
    assert.match(await statusText(api.page), /输入关键词/)
    assert.equal(new URL(api.page.url()).searchParams.get('q'), null)
    checks.push('clearing during a pending full-text request cannot restore stale results')
  },
  async retry404(api, checks) {
    api.failFirst(404)
    await visit(api.page, '/search/?q=8086')
    await phase(api.page, 'error')
    assert.ok((await urls(api.page)).length > 0, 'failed full text preserves metadata results')
    assert.match(await statusText(api.page), /正文暂时无法载入/)
    await api.screenshot('fallback')
    await api.page.locator('[data-search-retry]').click()
    await phase(api.page, 'complete')
    await assertQuery(api.page, '8086')
    assert.equal(api.fullRequests.length, 2, 'retry issues a new request after failure')
    checks.push('404 full-text response keeps useful metadata matches', 'explicit retry recovers and clears error')
  },
  async navigation(api, checks) {
    const release = api.hold()
    await visit(api.page, '/search/?q=IEEE754')
    await phase(api.page, 'partial')
    await api.page.locator('.site-brand').click()
    await api.page.locator('#home-title').waitFor()
    release()
    await api.page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/search-data/'))
    await paint(api.page)
    await api.page.locator('.site-search-link').click()
    await ready(api.page)
    await query(api.page, 'unsigned')
    await assertQuery(api.page, 'unsigned')
    await api.page.locator('.site-nav a[href="/articles/"]').click()
    await api.page.waitForURL(url => url.pathname === '/articles/')
    await api.page.goBack()
    await ready(api.page)
    await phase(api.page, 'complete')
    assert.equal(await api.page.locator(inputSelector).inputValue(), 'unsigned')
    await assertQuery(api.page, 'unsigned')
    await api.page.goForward()
    await api.page.waitForURL(url => url.pathname === '/articles/')
    await api.page.goBack()
    await ready(api.page)
    await phase(api.page, 'complete')
    await assertQuery(api.page, 'unsigned')
    assert.equal(api.fullRequests.length, 1, 'SPA leave/return/history reuse full text')
    checks.push('pending request survives leaving without writing to new page', 'returning search reuses full text', 'history back/forward restores query and results')
  },
}

try {
  for (const [name, scenario] of Object.entries(scenarios)) await run(name, false, scenario)
  for (const name of ['compact', 'language', 'ime', 'stale', 'navigation']) await run(name, true, scenarios[name])
} finally {
  await browser.close()
  report.completed = new Date().toISOString()
  report.passed = report.scenarios.filter(item => item.status === 'passed').length
  report.failed = report.scenarios.filter(item => item.status === 'failed').length
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify({ passed: report.passed, failed: report.failed, report: resolve(output, 'report.json') }))
if (report.failed) process.exitCode = 1
