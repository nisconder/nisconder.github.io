import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setImmediate as nextTurn } from 'node:timers/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/pages/music/index.astro', import.meta.url), 'utf8')
const script = source.match(/<script is:inline data-astro-rerun>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script, 'the regression executes the actual music page lifecycle')
const cssUrl = 'https://cdn.jsdelivr.net/npm/aplayer@1.10.1/dist/APlayer.min.css'
const jsUrl = 'https://cdn.jsdelivr.net/npm/aplayer@1.10.1/dist/APlayer.min.js'

class Element extends EventTarget {
  constructor(tagName = 'div') {
    super()
    this.tagName = tagName
    this.dataset = {}
    this.attributes = new Map()
    this.children = []
    this.isConnected = true
    this.textContent = ''
    this.classList = { toggle() {} }
  }

  setAttribute(key, value) { this.attributes.set(key, String(value)) }
  getAttribute(key) { return this.attributes.get(key) ?? null }
  toggleAttribute(key, value) {
    if (value) this.setAttribute(key, '')
    else this.attributes.delete(key)
  }
  append(child) { this.insertBefore(child, null) }
  insertBefore(child, before) {
    child.remove()
    const index = before ? this.children.indexOf(before) : this.children.length
    assert.notEqual(index, -1)
    this.children.splice(index, 0, child)
    child.parentElement = this
    child.isConnected = true
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1)
      this.parentElement = undefined
    }
    this.isConnected = false
  }
  replaceChildren() { [...this.children].forEach((child) => child.remove()) }
  querySelector(selector) {
    if (selector === 'style, link[rel="stylesheet"]') {
      return this.children.find((child) => child.tagName === 'style' || child.rel === 'stylesheet') ?? null
    }
    return null
  }
}

const setup = () => {
  const head = new Element('head')
  const siteStyle = new Element('link')
  siteStyle.href = '/_astro/music.css'
  siteStyle.rel = 'stylesheet'
  head.append(siteStyle)
  const walineStyle = new Element('link')
  walineStyle.href = 'https://cdn.jsdelivr.net/npm/@waline/client@3.7.1/dist/waline.css'
  walineStyle.rel = 'stylesheet'
  head.append(walineStyle)

  const document = new EventTarget()
  document.head = head
  document.createElement = (tag) => new Element(tag)
  let nodes
  const makePage = () => {
    nodes = new Map(['music-studio', 'aplayer-mount', 'player-shell', 'player-status', 'player-tracks']
      .map((name) => [`[data-${name}]`, new Element()]))
    nodes.get('[data-player-tracks]').textContent = JSON.stringify([
      { name: 'Test track', artist: 'Test artist', url: 'https://example.test/audio.mp3', cover: '/cover.png' },
    ])
  }
  makePage()
  document.querySelector = (selector) => {
    if (selector.startsWith('link[rel="stylesheet"][href=')) {
      return head.children.find((child) => child.href === cssUrl) ?? null
    }
    return nodes.get(selector) ?? null
  }
  document.querySelectorAll = () => []

  let timerId = 0
  const timers = new Map()
  const instances = []
  class Player {
    constructor(options) {
      this.options = options
      this.list = { index: 0 }
      this.audio = { paused: true, duration: Number.NaN, pause() {}, removeAttribute() {}, load() {} }
      this.destroyed = false
      instances.push(this)
      options.container.replaceChildren()
    }
    on() {}
    destroy() { this.destroyed = true }
  }
  const window = {
    matchMedia: () => ({ matches: true }),
    setTimeout: (callback, delay) => {
      const id = ++timerId
      timers.set(id, { callback, delay })
      return id
    },
    clearTimeout: (id) => timers.delete(id),
  }
  const context = vm.createContext({
    window, document, HTMLElement: Element, AbortController, DOMException,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
  })
  const run = () => vm.runInContext(script, context)
  const getCss = () => head.children.find((node) => node.href === cssUrl)
  const getJs = () => head.children.find((node) => node.src === jsUrl)
  const getMount = () => nodes.get('[data-aplayer-mount]')
  const getStatus = () => nodes.get('[data-player-status]')
  const finishCss = () => {
    const css = getCss()
    assert.ok(css)
    css.sheet = {}
    css.dispatchEvent(new Event('load'))
  }
  const finishJs = () => {
    const js = getJs()
    assert.ok(js)
    window.APlayer = Player
    js.dispatchEvent(new Event('load'))
  }
  const leave = () => {
    document.dispatchEvent(new Event('astro:before-swap'))
    nodes.forEach((node) => { node.isConnected = false })
    // Astro removes these dynamic head assets during its swap.
    getCss()?.remove()
    getJs()?.remove()
    document.dispatchEvent(new Event('astro:after-swap'))
  }
  const retry = () => {
    const button = getMount().children.find((node) => node.tagName === 'button')
    assert.ok(button, 'failure presents a retry control')
    button.dispatchEvent(new Event('click'))
  }
  return {
    run, getCss, getJs, getMount, getStatus, finishCss, finishJs, leave, retry, makePage,
    head, siteStyle, walineStyle, timers, instances,
    fireTimeouts() { [...timers.values()].forEach(({ callback }) => callback()) },
  }
}

test('the destination HTML does not contain a render-blocking APlayer stylesheet', () => {
  const markup = source.slice(0, source.indexOf('<script is:inline data-astro-rerun>'))
  assert.ok(!markup.includes(cssUrl))
  assert.ok(source.includes(jsUrl), 'APlayer remains pinned to 1.10.1')
})

test('JS alone does not mount the player; CSS stays before all site/Waline overrides', async () => {
  const env = setup()
  env.run()
  assert.equal(env.head.children[0], env.getCss())
  assert.ok(env.head.children.indexOf(env.siteStyle) < env.head.children.indexOf(env.walineStyle))
  env.finishJs()
  await nextTurn()
  assert.equal(env.instances.length, 0)
  env.finishCss()
  await nextTurn()
  assert.equal(env.instances.length, 1)
  assert.equal(env.instances[0].options.autoplay, false)
  assert.equal(env.instances[0].options.preload, 'metadata')
  assert.equal(env.timers.size, 0)
})

test('CSS alone does not mount the player; later JS completes the same attempt', async () => {
  const env = setup()
  env.run()
  env.finishCss()
  await nextTurn()
  assert.equal(env.instances.length, 0)
  env.finishJs()
  await nextTurn()
  assert.equal(env.instances.length, 1)
})

test('CSS failure can retry without reloading an already ready library', async () => {
  const env = setup()
  env.run()
  env.finishJs()
  env.getCss().dispatchEvent(new Event('error'))
  await nextTurn()
  assert.equal(env.instances.length, 0)
  assert.equal(env.getCss(), undefined)
  assert.equal(env.getStatus().dataset.state, 'error')
  const library = env.getJs()
  env.retry()
  assert.equal(env.getJs(), library)
  env.finishCss()
  await nextTurn()
  assert.equal(env.instances.length, 1)
})

test('a stalled CDN request times out, cleans both assets, and can retry', async () => {
  const env = setup()
  env.run()
  assert.deepEqual([...env.timers.values()].map(({ delay }) => delay), [15000, 15000])
  env.fireTimeouts()
  await nextTurn()
  assert.equal(env.getCss(), undefined)
  assert.equal(env.getJs(), undefined)
  assert.equal(env.getStatus().dataset.state, 'error')
  assert.equal(env.timers.size, 0)
  env.retry()
  env.finishCss()
  env.finishJs()
  await nextTurn()
  assert.equal(env.instances.length, 1)
})

test('leaving while assets load cancels both; reentry starts a fresh working attempt', async () => {
  const env = setup()
  env.run()
  const staleCss = env.getCss()
  const staleJs = env.getJs()
  env.leave()
  await nextTurn()
  assert.equal(env.timers.size, 0)
  assert.equal(env.instances.length, 0)
  env.makePage()
  env.run()
  assert.notEqual(env.getCss(), staleCss)
  assert.notEqual(env.getJs(), staleJs)
  staleCss.dispatchEvent(new Event('load'))
  staleJs.dispatchEvent(new Event('load'))
  await nextTurn()
  assert.equal(env.instances.length, 0)
  env.finishCss()
  env.finishJs()
  await nextTurn()
  assert.equal(env.instances.length, 1)
})

test('a mounted player is destroyed on leave; reentry reloads CSS but reuses JS', async () => {
  const env = setup()
  env.run()
  env.finishCss()
  env.finishJs()
  await nextTurn()
  env.leave()
  await nextTurn()
  assert.equal(env.instances[0].destroyed, true)
  env.makePage()
  env.run()
  assert.equal(env.getJs(), undefined)
  assert.ok(env.getCss())
  await nextTurn()
  assert.equal(env.instances.length, 1)
  env.finishCss()
  await nextTurn()
  assert.equal(env.instances.length, 2)
})
