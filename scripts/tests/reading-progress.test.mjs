import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const page = await readFile(new URL('../../src/pages/[year]/[month]/[day]/[slug].astro', import.meta.url), 'utf8')
const script = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .find((match) => match[1].includes("querySelector('[data-reading-root]')"))?.[1]
assert.ok(script, 'test the actual article reading script')

function fixture({ scrollY = 600, resizeObserver = true } = {}) {
  const operations = []
  const frames = new Map()
  let frameId = 0
  let bodyMeasurements = 0
  let observer
  let binding = true
  class HTMLElement extends EventTarget {
    dataset = {}
    isConnected = true
    textContent = ''
    attributes = new Map()
    style = new Proxy({}, { set: (style, key, value) => {
      operations.push('write')
      style[key] = value
      return true
    } })
    setAttribute(key, value) { operations.push('write'); this.attributes.set(key, value) }
    removeAttribute(key) { operations.push('write'); this.attributes.delete(key) }
    getAttribute(key) { return this.attributes.get(key) }
  }
  class HTMLDetailsElement extends HTMLElement {}
  const document = new EventTarget()
  const window = Object.assign(new EventTarget(), {
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId },
  })
  const viewport = { scrollY, innerHeight: 500, innerWidth: 375 }
  for (const key of Object.keys(viewport)) {
    Object.defineProperty(window, key, {
      get() {
        if (binding) throw new Error(`Geometry read during binding: ${key}`)
        operations.push('read')
        return viewport[key]
      },
      set(value) { viewport[key] = value },
    })
  }
  const cancelAnimationFrame = (id) => frames.delete(id)
  const root = new HTMLElement()
  const body = new HTMLElement()
  body.top = 100
  body.getBoundingClientRect = () => {
    operations.push('read')
    bodyMeasurements += 1
    return { top: body.top - window.scrollY }
  }
  Object.defineProperty(body, 'scrollHeight', { get: () => { operations.push('read'); return 1000 } })
  const headings = ['First', 'Second'].map((title, index) => Object.assign(new HTMLElement(), {
    id: `heading-${index}`, textContent: title,
    getBoundingClientRect() {
      operations.push('read')
      return { top: body.top + index * 600 - window.scrollY }
    },
  }))
  const links = headings.map((heading) => {
    const link = new HTMLElement()
    link.attributes.set('href', `#${heading.id}`)
    return link
  })
  const bar = new HTMLElement()
  const output = new HTMLElement()
  const meter = new HTMLElement()
  const label = new HTMLElement()
  const mobileToc = new HTMLDetailsElement()
  let toggleCapture = false
  const rootAddListener = root.addEventListener.bind(root)
  root.addEventListener = (name, callback, options) => {
    if (name === 'toggle') toggleCapture = options?.capture === true
    rootAddListener(name, callback, options)
  }
  root.querySelector = (selector) => selector === '[data-reading-body]' ? body : mobileToc
  root.querySelectorAll = (selector) => ({
    '[data-reading-output]': [output], '[data-reading-meter]': [meter],
    '[data-toc-link]': links, '[data-current-heading]': [label],
  })[selector] ?? []
  body.querySelectorAll = () => headings
  document.querySelector = () => root
  document.querySelectorAll = () => [bar]
  // Reading FontFaceSet.ready itself can force initial layout. System fonts and
  // ResizeObserver make that read unnecessary for this page.
  Object.defineProperty(document, 'fonts', { get() { throw new Error('Do not read document.fonts') } })
  class ResizeObserver {
    disconnected = false
    constructor(callback) { this.callback = callback; observer = this }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  if (resizeObserver) window.ResizeObserver = ResizeObserver
  const context = { window, document, HTMLElement, HTMLDetailsElement, Element: HTMLElement,
    AbortController, ResizeObserver, cancelAnimationFrame }
  runInNewContext(script, context)
  binding = false
  return {
    window, document, root, body, output, label, links, meter, operations, frames,
    get measurements() { return bodyMeasurements },
    get toggleCapture() { return toggleCapture },
    get observer() { return observer },
    rerun: () => runInNewContext(script, context),
    emit: (target, type) => target.dispatchEvent(new Event(type)),
    tick() {
      const pending = [...frames.values()]
      frames.clear()
      operations.length = 0
      pending.forEach((callback) => callback())
    },
  }
}

test('initial restored scroll and overlapping layout signals share one read-before-write frame', () => {
  const f = fixture()
  assert.equal(f.operations.length, 0)
  assert.equal(f.frames.size, 0, 'wait for the first natural layout notification')
  f.emit(f.document, 'astro:page-load')
  f.emit(f.window, 'scroll')
  f.emit(f.window, 'resize')
  assert.equal(f.frames.size, 0)
  assert.equal(f.operations.length, 0)
  f.observer.callback()
  f.rerun()
  assert.equal(f.frames.size, 1)
  assert.equal(f.measurements, 0)
  f.tick()
  assert.equal(f.measurements, 1)
  assert.equal(f.output.textContent, '66%')
  assert.equal(f.label.textContent, 'Second')
  assert.equal(f.links[1].getAttribute('aria-current'), 'location')
  const firstWrite = f.operations.indexOf('write')
  assert.ok(firstWrite > 0)
  assert.ok(f.operations.slice(firstWrite).every((operation) => operation !== 'read'))
})

test('scroll and height-only resize update progress without measuring article geometry', () => {
  const f = fixture()
  f.observer.callback()
  f.tick()
  f.window.scrollY = 140
  f.emit(f.window, 'scroll')
  f.emit(f.window, 'scroll')
  assert.equal(f.frames.size, 1)
  f.tick()
  assert.equal(f.output.textContent, '20%')
  assert.equal(f.label.textContent, 'First')
  assert.equal(f.measurements, 1)
  f.window.innerHeight = 1000
  f.emit(f.window, 'resize')
  f.tick()
  assert.equal(f.output.textContent, '36%')
  assert.equal(f.measurements, 1)
})

test('width changes and ResizeObserver notifications merge into one fresh measurement', () => {
  const f = fixture()
  f.observer.callback()
  f.tick()
  f.window.innerWidth = 768
  f.emit(f.window, 'resize')
  f.observer.callback()
  f.emit(f.document, 'astro:page-load')
  assert.equal(f.frames.size, 1)
  f.tick()
  assert.equal(f.measurements, 2)
})

test('captured details toggles refresh a moved body and its active heading', () => {
  const f = fixture()
  f.observer.callback()
  f.tick()
  assert.equal(f.toggleCapture, true, 'toggle does not bubble from nested details')
  f.body.top += 500
  f.emit(f.root, 'toggle')
  f.emit(f.root, 'toggle')
  f.tick()
  assert.equal(f.measurements, 2)
  assert.equal(f.output.textContent, '16%')
  assert.equal(f.label.textContent, 'First')
  assert.equal(f.links[1].getAttribute('aria-current'), undefined)
})

test('navigation cancels queued work and ignores late resize and observer callbacks', () => {
  const f = fixture()
  f.observer.callback()
  f.emit(f.document, 'astro:before-swap')
  assert.equal(f.observer.disconnected, true)
  assert.equal(f.root.dataset.readingBound, undefined)
  assert.equal(f.frames.size, 0)
  f.emit(f.window, 'resize')
  f.emit(f.window, 'scroll')
  f.emit(f.root, 'toggle')
  f.observer.callback()
  f.tick()
  assert.equal(f.measurements, 0)
  assert.equal(f.frames.size, 0)
})

test('without ResizeObserver, geometry reads wait until the second animation frame', () => {
  const f = fixture({ resizeObserver: false })
  assert.equal(f.operations.length, 0)
  assert.equal(f.frames.size, 1)
  f.tick()
  assert.equal(f.operations.length, 0)
  assert.equal(f.measurements, 0)
  assert.equal(f.frames.size, 1)
  f.tick()
  assert.equal(f.measurements, 1)
  assert.equal(f.output.textContent, '66%')
})

test('leaving during the no-observer fallback cancels its first frame', () => {
  const f = fixture({ resizeObserver: false })
  f.emit(f.document, 'astro:before-swap')
  f.tick()
  assert.equal(f.operations.length, 0)
  assert.equal(f.measurements, 0)
  assert.equal(f.frames.size, 0)
})
