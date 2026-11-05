import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

// Exercise the production controller with browser boundaries stubbed. The
// imported login observer has its own origin/payload/security regression tests.
const source = (await readFile(new URL('../../src/lib/comments-controller.mjs', import.meta.url), 'utf8'))
  .replace(/^import[^\n]*\n/, '').replace('export function ', 'function ')

function fixture({ mobile = false, prerendering = false } = {}) {
  const document = Object.assign(new EventTarget(), { prerendering })
  const styles = []
  const observers = []
  const calls = { init: 0, destroy: 0, loginBind: 0, loginDispose: 0 }
  class HTMLElement extends EventTarget {
    dataset = {}
    isConnected = true
    hidden = false
    textContent = ''
    children = []
    attributes = new Map()
    setAttribute(key, value) { this.attributes.set(key, value) }
    getAttribute(key) { return this.attributes.get(key) }
    replaceChildren(...children) { this.children = children }
    append(child) { this.children.push(child) }
    remove() { this.isConnected = false }
    contains() { return false }
    scrollIntoView() {}
  }
  class HTMLButtonElement extends HTMLElement {}
  class HTMLLinkElement extends HTMLElement {}
  class IntersectionObserver {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this) }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  const section = new HTMLElement()
  const root = new HTMLElement()
  root.dataset.walinePath = '/sample-article/'
  const status = new HTMLElement()
  const loginStatus = new HTMLElement()
  const body = new HTMLElement()
  const toggle = new HTMLButtonElement()
  const label = new HTMLElement()
  section.querySelector = (selector) => ({
    '[data-waline-root]': root, '[data-waline-status]': status,
    '[data-waline-login-status]': loginStatus, '[data-comments-body]': body,
    '[data-comments-toggle]': toggle, '[data-comments-toggle-label]': label,
  })[selector]
  document.querySelectorAll = () => section.dataset.commentsBound ? [] : [section]
  document.querySelector = () => styles.find((link) => link.isConnected)
  document.createElement = (tag) => tag === 'link' ? new HTMLLinkElement() : new HTMLButtonElement()
  document.head = { append: (link) => styles.push(link) }
  const mobileQuery = Object.assign(new EventTarget(), { matches: mobile })
  const window = Object.assign(new EventTarget(), {
    IntersectionObserver,
    matchMedia: (query) => query.includes('max-width') ? mobileQuery : { matches: true },
    clearTimeout() {},
    __nisconderWalineModule: Promise.resolve({ init(options) {
      calls.init += 1
      calls.options = options
      return { destroy() { calls.destroy += 1 } }
    } }),
  })
  const context = { document, window, HTMLElement, HTMLButtonElement, HTMLLinkElement,
    IntersectionObserver, AbortController, DOMException,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    bindWalineLoginFeedback() {
      calls.loginBind += 1
      return () => { calls.loginDispose += 1 }
    },
  }
  runInNewContext(`${source}\ninstallCommentsController()`, context)
  return {
    document, window, section, root, status, body, toggle, styles, observers, calls,
    installAgain: () => runInNewContext('installCommentsController()', context),
    emit: (target, type) => target.dispatchEvent(new Event(type)),
    intersect(value = true) { observers.at(-1).callback([{ isIntersecting: value }]) },
    loadStyle() { const link = styles.at(-1); link.sheet = {}; link.dispatchEvent(new Event('load')) },
    flush: () => new Promise(setImmediate),
  }
}

test('prerender delays all binding and Waline loading until activation, then initializes once', async () => {
  const f = fixture({ prerendering: true })
  f.installAgain()
  f.emit(f.document, 'astro:page-load')
  assert.equal(f.section.dataset.commentsBound, undefined)
  assert.equal(f.calls.loginBind, 0)
  assert.equal(f.observers.length, 0)
  assert.equal(f.styles.length, 0)
  f.document.prerendering = false
  f.emit(f.document, 'prerenderingchange')
  f.emit(f.document, 'astro:page-load')
  assert.equal(f.calls.loginBind, 1)
  assert.equal(f.observers.length, 1)
  f.intersect(false)
  assert.equal(f.styles.length, 0)
  f.intersect()
  f.loadStyle()
  await f.flush()
  assert.equal(f.calls.init, 1)
  assert.equal(f.calls.options.path, '/sample-article/')
  assert.equal(f.calls.options.serverURL, 'https://my-waline-pink.vercel.app')
})

test('mobile toggle works immediately, loads only on expansion and survives BFCache pagehide', async () => {
  const f = fixture({ mobile: true })
  assert.equal(f.toggle.hidden, false)
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(f.body.hidden, true)
  assert.equal(f.styles.length, 0)
  assert.equal(f.observers.length, 0)
  f.emit(f.toggle, 'click')
  assert.equal(f.body.hidden, false)
  assert.equal(f.toggle.getAttribute('aria-expanded'), 'true')
  f.loadStyle()
  await f.flush()
  assert.equal(f.root.dataset.walineState, 'ready')
  f.emit(f.window, 'pagehide')
  f.emit(f.window, 'pageshow')
  assert.equal(f.calls.destroy, 0)
  assert.equal(f.calls.loginDispose, 0)
  f.emit(f.toggle, 'click')
  assert.equal(f.body.hidden, true)
  f.emit(f.toggle, 'click')
  assert.equal(f.body.hidden, false)
  assert.equal(f.calls.init, 1)
})

test('a failed stylesheet offers retry and a fresh successful load', async () => {
  const f = fixture({ mobile: true })
  f.emit(f.toggle, 'click')
  f.emit(f.styles[0], 'error')
  await f.flush()
  assert.equal(f.root.dataset.walineState, 'error')
  assert.equal(f.styles[0].isConnected, false)
  const retry = f.status.children.find((child) => typeof child === 'object')
  assert.equal(retry.textContent, '重新加载')
  f.emit(retry, 'click')
  assert.equal(f.styles.length, 2)
  f.loadStyle()
  await f.flush()
  assert.equal(f.root.dataset.walineState, 'ready')
  assert.equal(f.calls.init, 1)
})

test('Astro cleanup waits for the actual swap and disposes the combined login binding', async () => {
  const f = fixture()
  f.intersect()
  f.loadStyle()
  await f.flush()
  let swapped = false
  const event = Object.assign(new Event('astro:before-swap'), { swap() { swapped = true } })
  f.document.dispatchEvent(event)
  assert.equal(f.calls.destroy, 0)
  event.swap()
  assert.equal(swapped, true)
  assert.equal(f.calls.destroy, 1)
  assert.equal(f.calls.loginDispose, 1)
  assert.equal(f.root.__walineInstance, undefined)
})

test('leaving before the stylesheet finishes cannot initialize a detached comment widget', async () => {
  const f = fixture()
  f.intersect()
  const event = Object.assign(new Event('astro:before-swap'), { swap() {} })
  f.document.dispatchEvent(event)
  event.swap()
  f.loadStyle()
  await f.flush()
  assert.equal(f.calls.init, 0)
  assert.equal(f.styles[0].isConnected, false)
  assert.equal(f.calls.loginDispose, 1)
})
