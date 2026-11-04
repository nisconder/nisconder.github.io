// Reproducible, read-only Chromium search benchmark. No networkidle readiness.
// node scripts/qa-search-performance.mjs --modules <existing node_modules> --label baseline
// Optional: --targets local,online --devices desktop,mobile --iterations 1
//           --local http://127.0.0.1:4328/ --online https://nisconder.pages.dev/
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const require = createRequire(resolve(option('--modules', './node_modules'), 'package.json'))
const { chromium } = require('playwright')
const label = option('--label', 'baseline')
assert.match(label, /^[a-z0-9_-]+$/i)
const targets = {
  local: option('--local', 'http://127.0.0.1:4328/'),
  online: option('--online', 'https://nisconder.pages.dev/'),
}
const selectedTargets = option('--targets', 'local,online').split(',')
const devices = option('--devices', 'desktop,mobile').split(',')
const scenarios = option('--scenarios', 'cold-search,cold-query,home-to-search').split(',')
const traceEnabled = args.includes('--trace')
const iterations = Number(option('--iterations', '1'))
assert.ok(iterations >= 1 && iterations <= 10)
const output = resolve(import.meta.dirname, '..', '.deploy-search-performance', label)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const throttle = { latencyMs: 150, downloadMbps: 1.6, uploadMbps: 0.75, cpuSlowdown: 4 }
const allResults = await readFile(resolve(output, 'summary.json'), 'utf8').then(source => JSON.parse(source).results).catch(error => {
  if (error.code === 'ENOENT') return []
  throw error
})
const round = number => Math.round(number * 10) / 10

async function session(base, device) {
  const mobile = device === 'mobile'
  const context = await browser.newContext({
    viewport: mobile ? { width: 375, height: 812 } : { width: 1440, height: 1000 },
    isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1,
    reducedMotion: 'no-preference', serviceWorkers: 'block',
  })
  await context.addInitScript(() => {
    const data = window.__searchBenchmark = { longTasks: [], inputFrames: [], paint: [], resultPaints: [], intent: 0, events: [], errors: [] }
    const observe = (type, callback, options = {}) => {
      try { new PerformanceObserver(list => list.getEntries().forEach(callback)).observe({ type, buffered: true, ...options }) } catch {}
    }
    observe('longtask', entry => data.longTasks.push({ start: entry.startTime, duration: entry.duration }))
    observe('paint', entry => data.paint.push({ name: entry.name, start: entry.startTime }))
    observe('event', entry => data.events.push({ name: entry.name, start: entry.startTime, duration: entry.duration, processingStart: entry.processingStart, processingEnd: entry.processingEnd, interactionId: entry.interactionId }), { durationThreshold: 16 })
    document.addEventListener('input', event => {
      if (!event.target.matches?.('[data-search-input]')) return
      const start = performance.now()
      data.intent = start
      requestAnimationFrame(() => data.inputFrames.push({ value: event.target.value, start, duration: performance.now() - start }))
    }, true)
    document.addEventListener('submit', event => { if (event.target.matches?.('[data-search-form]')) data.intent = performance.now() }, true)
    new MutationObserver(records => {
      if (!records.some(record => (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest?.('[data-search-results], [data-search-status]'))) return
      const input = document.querySelector('[data-search-input]')
      const first = document.querySelector('[data-search-results] .search-result')
      const query = new URL(location.href).searchParams.get('q') || ''
      if (!first || !query || input?.value.trim() !== query) return
      const intent = data.intent
      const phase = document.querySelector('[data-search-status]')?.dataset.searchPhase || 'complete'
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (data.intent !== intent || document.querySelector('[data-search-input]')?.value.trim() !== query) return
        data.resultPaints.push({ query, intent, phase, epoch: performance.timeOrigin + performance.now() })
      }))
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-search-phase'] })
    window.addEventListener('error', event => data.errors.push(event.message))
    window.addEventListener('unhandledrejection', event => data.errors.push(String(event.reason)))
  })
  const page = await context.newPage()
  page.setDefaultTimeout(45000)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: throttle.latencyMs,
    downloadThroughput: throttle.downloadMbps * 1000000 / 8,
    uploadThroughput: throttle.uploadMbps * 1000000 / 8,
    connectionType: 'cellular3g',
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle.cpuSlowdown })
  let tracingComplete
  if (traceEnabled) {
    tracingComplete = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack', transferMode: 'ReturnAsStream' })
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
    await cdp.send('Profiler.start')
  }
  const requests = new Map()
  const waterfall = []
  let firstTimestamp
  cdp.on('Network.requestWillBeSent', event => {
    firstTimestamp ??= event.timestamp
    const previous = requests.get(event.requestId)
    if (previous && event.redirectResponse) previous.redirectStatus = event.redirectResponse.status
    const record = { url: event.request.url, method: event.request.method, type: event.type, priority: event.request.initialPriority, startMs: round((event.timestamp - firstTimestamp) * 1000), requestEpoch: event.wallTime * 1000, initiator: event.initiator.type, bytes: 0 }
    requests.set(event.requestId, record)
    waterfall.push(record)
  })
  cdp.on('Network.responseReceived', event => {
    const record = requests.get(event.requestId)
    if (!record) return
    const encoding = Object.entries(event.response.headers).find(([name]) => name.toLowerCase() === 'content-encoding')?.[1]
    const timing = event.response.timing
    const ttfb = timing && timing.receiveHeadersEnd >= 0 ? (timing.requestTime - firstTimestamp) * 1000 + timing.receiveHeadersEnd - record.startMs : null
    Object.assign(record, { status: event.response.status, mime: event.response.mimeType, contentEncoding: encoding, ttfbMs: ttfb === null ? null : round(ttfb), responseEventDelayMs: round((event.timestamp - firstTimestamp) * 1000 - record.startMs), fromDiskCache: Boolean(event.response.fromDiskCache), fromServiceWorker: Boolean(event.response.fromServiceWorker), protocol: event.response.protocol })
  })
  cdp.on('Network.loadingFinished', event => {
    const record = requests.get(event.requestId)
    if (record) Object.assign(record, { endMs: round((event.timestamp - firstTimestamp) * 1000), durationMs: round((event.timestamp - firstTimestamp) * 1000 - record.startMs), bytes: event.encodedDataLength })
  })
  cdp.on('Network.loadingFailed', event => {
    const record = requests.get(event.requestId)
    if (record) Object.assign(record, { failed: event.errorText, canceled: event.canceled })
  })
  async function finishTrace(name) {
    if (!traceEnabled) return
    const { profile } = await cdp.send('Profiler.stop')
    await writeFile(resolve(output, `${name}.cpuprofile`), JSON.stringify(profile))
    await cdp.send('Tracing.end')
    const { stream } = await tracingComplete
    const chunks = []
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: stream, size: 1048576 })
      chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString('utf8') : chunk.data)
      if (chunk.eof) break
    }
    await cdp.send('IO.close', { handle: stream })
    const rawTrace = chunks.join('')
    await writeFile(resolve(output, `${name}.trace.json`), rawTrace)
    const trace = JSON.parse(rawTrace)
    const renderer = trace.traceEvents.filter(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
    const onRenderer = event => renderer.some(thread => thread.pid === event.pid && thread.tid === event.tid)
    const expensiveEvents = trace.traceEvents.filter(event => event.ph === 'X' && event.dur >= 5000 && onRenderer(event)).sort((a, b) => b.dur - a.dur).slice(0, 60).map(event => ({ name: event.name, durationMs: event.dur / 1000, timestamp: event.ts, data: event.args?.data, stack: event.args?.beginData?.stackTrace }))
    const nodeById = new Map(profile.nodes.map(node => [node.id, node]))
    const selfTime = new Map()
    for (let index = 0; index < (profile.samples?.length ?? 0); index++) selfTime.set(profile.samples[index], (selfTime.get(profile.samples[index]) ?? 0) + (profile.timeDeltas[index] ?? 0))
    const topFrames = [...selfTime].sort((a, b) => b[1] - a[1]).slice(0, 35).map(([id, microseconds]) => ({ ...nodeById.get(id).callFrame, sampledSelfMs: microseconds / 1000 }))
    await writeFile(resolve(output, `${name}.trace-summary.json`), JSON.stringify({ expensiveEvents, topFrames }, null, 2) + '\n')
  }
  return { context, page, waterfall, finishTrace }
}

async function nextPaint(page) {
  return page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now())))))
}
async function inputReady(page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('[data-search-form]')
    const input = document.querySelector('[data-search-input]')
    if (!input || !form || form.dataset.searchBound !== 'true' || input.disabled) return false
    const box = input.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && getComputedStyle(input).visibility !== 'hidden'
  }, null, { polling: 'raf' })
  return nextPaint(page)
}
async function resultReady(page, query) {
  // This waits for full-text completion. Immediate metadata results have a
  // separate MutationObserver + animation-frame timestamp (firstBatchPaint).
  await page.waitForFunction(query => {
    const status = document.querySelector('[data-search-status]')
    return (status?.dataset.searchPhase ? status.dataset.searchPhase === 'complete' : status?.textContent.includes(query)) && document.querySelector('[data-search-input]')?.value.trim() === query && document.querySelector('[data-search-results] .search-result')
  }, query, { polling: 'raf' })
  return nextPaint(page)
}
async function firstBatchPaint(page, query) {
  await page.waitForFunction(query => window.__searchBenchmark.resultPaints.some(entry => entry.query === query && entry.intent === window.__searchBenchmark.intent), query, { polling: 'raf' })
  return page.evaluate(query => window.__searchBenchmark.resultPaints.find(entry => entry.query === query && entry.intent === window.__searchBenchmark.intent), query)
}
async function snapshot(page, waterfall, beforeEpoch, afterEpoch) {
  const measurements = await page.evaluate(() => ({
    ...window.__searchBenchmark,
    timeOrigin: performance.timeOrigin,
    navigation: performance.getEntriesByType('navigation').map(entry => ({ startTime: entry.startTime, responseStart: entry.responseStart, domContentLoaded: entry.domContentLoadedEventEnd, load: entry.loadEventEnd, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize })),
    resources: performance.getEntriesByType('resource').map(entry => ({ name: entry.name, startTime: entry.startTime, requestStart: entry.requestStart, responseStart: entry.responseStart, responseEnd: entry.responseEnd, duration: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize })),
    resultCount: document.querySelectorAll('[data-search-results] .search-result').length,
    inputInViewport: (() => { const rect = document.querySelector('[data-search-input]')?.getBoundingClientRect(); return Boolean(rect && rect.top >= 0 && rect.bottom <= innerHeight) })(),
    firstResultInViewport: (() => { const rect = document.querySelector('[data-search-results] .search-result')?.getBoundingClientRect(); return Boolean(rect && rect.top < innerHeight && rect.bottom > 0) })(),
    firstResultContentVisible: document.querySelector('[data-search-results] .search-result')?.checkVisibility?.({ contentVisibilityAuto: true }) ?? null,
  }))
  const selected = waterfall.filter(request => request.requestEpoch >= beforeEpoch && request.requestEpoch <= afterEpoch)
  const tasks = measurements.longTasks.filter(task => measurements.timeOrigin + task.start >= beforeEpoch && measurements.timeOrigin + task.start <= afterEpoch)
  return {
    requestCount: selected.length,
    transferredBytesCompleted: selected.reduce((sum, request) => sum + request.bytes, 0),
    outstandingRequests: selected.filter(request => request.endMs === undefined && !request.failed).length,
    longTaskCount: tasks.length,
    totalBlockingMs: round(tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
    maxLongTaskMs: round(Math.max(0, ...tasks.map(task => task.duration))),
    measurements,
  }
}

async function measure(base, device, target, iteration, scenario) {
  const { context, page, waterfall, finishTrace } = await session(base, device)
  const name = `${target}-${device}-${iteration}-${scenario}`
  const start = Date.now()
  const result = { target, base, device, iteration, scenario, throttle, timings: {} }
  try {
    if (scenario === 'cold-query') {
      await page.goto(new URL('/search/?q=8086', base).href, { waitUntil: 'commit' })
      const ready = await inputReady(page)
      result.timings.inputReadyMs = round(ready - start)
      const firstBatch = await firstBatchPaint(page, '8086')
      result.timings.firstBatchMs = round(firstBatch.epoch - start)
      result.firstBatchPhase = firstBatch.phase
      result.timings.fullResultMs = round(await resultReady(page, '8086') - start)
    } else if (scenario === 'cold-search') {
      await page.goto(new URL('/search/', base).href, { waitUntil: 'commit' })
      const ready = await inputReady(page)
      result.timings.inputReadyMs = round(ready - start)
      result.atInputReady = await snapshot(page, waterfall, start, ready)
      const input = page.locator('[data-search-input]')
      const searchStart = Date.now()
      await input.click()
      await input.pressSequentially('8086', { delay: 30 })
      const submitStart = Date.now()
      await input.press('Enter')
      const results = await resultReady(page, '8086')
      result.timings.focusTypeAndFullResultMs = round(results - searchStart)
      result.timings.submitToFullResultMs = round(results - submitStart)
    } else {
      await page.goto(new URL('/', base).href, { waitUntil: 'commit' })
      await page.locator('#home-title').waitFor()
      await nextPaint(page)
      const clickStart = Date.now()
      await page.locator('.site-search-link').click()
      await page.waitForURL(url => url.pathname === '/search/')
      result.timings.homeClickToInputReadyMs = round(await inputReady(page) - clickStart)
      const input = page.locator('[data-search-input]')
      await input.fill('8086')
      const submitStart = Date.now()
      await input.press('Enter')
      result.timings.firstSubmitToFullResultMs = round(await resultReady(page, '8086') - submitStart)
      result.repeatNavigation = []
      for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator('.site-brand').click()
        await page.waitForURL(new URL('/', base).href)
        await page.locator('#home-title').waitFor()
        await nextPaint(page)
        const repeatStart = Date.now()
        const requestsBefore = waterfall.length
        await page.locator('.site-search-link').click()
        await page.waitForURL(url => url.pathname === '/search/')
        const ready = await inputReady(page)
        await input.fill('8086')
        const submit = Date.now()
        await input.press('Enter')
        const found = await resultReady(page, '8086')
        result.repeatNavigation.push({ inputReadyMs: round(ready - repeatStart), submitToFullResultMs: round(found - submit), requests: waterfall.length - requestsBefore })
      }
      result.warmInputs = []
      for (const query of ['8086 寄存器', '编译', '8086']) {
        const inputStart = Date.now()
        await input.fill(query)
        const submit = Date.now()
        await input.press('Enter')
        const found = await resultReady(page, query)
        result.warmInputs.push({ query, inputAndSubmitToFullResultMs: round(found - inputStart), submitToFullResultMs: round(found - submit) })
      }
    }
    const end = Date.now()
    Object.assign(result, await snapshot(page, waterfall, start, end))
    result.timings.fcpMs = result.measurements.paint.find(entry => entry.name === 'first-contentful-paint')?.start ?? null
    result.resultViewport = { initiallyInViewport: result.measurements.firstResultInViewport, initiallyContentVisible: result.measurements.firstResultContentVisible }
    if (result.measurements.resultCount > 0 && !result.measurements.firstResultInViewport) {
      const scrollStart = Date.now()
      await page.locator('[data-search-results] .search-result').first().scrollIntoViewIfNeeded()
      result.resultViewport.scrollToPaintMs = round(await nextPaint(page) - scrollStart)
    }
    result.waterfall = waterfall
    result.status = 'passed'
  } catch (error) {
    result.status = 'failed'
    result.error = error.message
    result.waterfall = waterfall
    await page.screenshot({ path: resolve(output, `${target}-${device}-${iteration}-${scenario}-failure.png`) }).catch(() => {})
  } finally {
    await finishTrace(name)
    await context.close()
  }
  await writeFile(resolve(output, `${name}.json`), JSON.stringify(result, null, 2) + '\n')
  const existing = allResults.findIndex(item => item.target === target && item.device === device && item.iteration === iteration && item.scenario === scenario)
  if (existing === -1) allResults.push(result)
  else allResults[existing] = result
  console.log(JSON.stringify({ name, status: result.status, timings: result.timings, requests: result.requestCount, bytes: result.transferredBytesCompleted, blockingMs: result.totalBlockingMs, repeats: result.repeatNavigation, error: result.error }))
  await writeFile(resolve(output, 'summary.json'), JSON.stringify({ label, throttle, notes: ['Fresh incognito context per scenario; normal cache retained within repeat navigation.', '150ms synthetic latency is added to the real connection; local and online transfer sizes may differ due to server compression.', 'Input readiness requires visible non-disabled input plus bound search handlers and a subsequent paint.', 'Full-result metrics wait for complete full-text search. firstBatchMs separately records query-specific result DOM changes and two animation frames; resultViewport reports whether scrolling was needed.', 'inputFrames are input-event-to-next-animation-frame samples, not an INP score.', 'Byte totals include completed requests by the measurement endpoint; outstanding requests are reported separately.'], results: allResults }, null, 2) + '\n')
}

try {
  for (const target of selectedTargets) {
    assert.ok(targets[target], `Unknown target ${target}`)
    for (const device of devices) {
      assert.ok(['desktop', 'mobile'].includes(device))
      for (let iteration = 1; iteration <= iterations; iteration++) {
        for (const scenario of scenarios) {
          assert.ok(['cold-search', 'cold-query', 'home-to-search'].includes(scenario))
          await measure(targets[target], device, target, iteration, scenario)
        }
      }
    }
  }
} finally {
  await browser.close()
}
if (allResults.some(result => result.status !== 'passed')) process.exitCode = 1
