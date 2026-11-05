import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/components/ThemeToggle.astro', import.meta.url), 'utf8')
const script = source.match(/<script is:inline data-astro-rerun>([\s\S]*?)<\/script>/)?.[1]
assert.ok(script)

function setup({ saved = 'light', darkSystem = false, animate = false } = {}) {
  const root = { dataset: {}, style: {}, hasAttribute: () => false }
  const label = { textContent: '' }
  const attributes = new Map()
  const button = Object.assign(new EventTarget(), {
    dataset: {},
    setAttribute: (name, value) => attributes.set(name, value),
    querySelector: () => label,
  })
  const document = Object.assign(new EventTarget(), {
    documentElement: root,
    querySelectorAll: () => [button],
    querySelector: () => ({ setAttribute() {} }),
  })
  const system = Object.assign(new EventTarget(), { matches: darkSystem })
  const window = Object.assign(new EventTarget(), {
    matchMedia: query => query.includes('color-scheme') ? system : { matches: !animate },
    setTimeout: () => 1,
    clearTimeout() {},
  })
  let stored = saved
  const pending = []
  if (animate) document.startViewTransition = callback => {
    const transition = { skipTransition() {}, finished: new Promise(() => {}) }
    pending.push(callback)
    return transition
  }
  vm.runInNewContext(script, {
    document, window, AbortController,
    localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value } },
  })
  return {
    root, attributes, label, button, pending,
    save: value => { stored = value },
    show: () => window.dispatchEvent(new Event('pageshow')),
    hide: () => window.dispatchEvent(new Event('pagehide')),
    activate: () => document.dispatchEvent(new Event('prerenderingchange')),
    swap: () => document.dispatchEvent(new Event('astro:before-swap')),
    systemChange: () => system.dispatchEvent(new Event('change')),
  }
}

test('native pageshow synchronizes a BFCache document to the latest saved theme', () => {
  const env = setup()
  assert.equal(env.root.dataset.theme, 'light')
  env.save('dark')
  env.hide()
  env.show()
  assert.equal(env.root.dataset.theme, 'dark')
  assert.equal(env.attributes.get('aria-pressed'), 'true')
  assert.equal(env.label.textContent, '浅色')
  env.button.dispatchEvent(new Event('click'))
  assert.equal(env.root.dataset.theme, 'light', 'the restored control remains bound exactly once')
})

test('a prerendered document reads the current theme when activated', () => {
  const env = setup()
  env.save('dark')
  env.activate()
  assert.equal(env.root.dataset.theme, 'dark')
  assert.equal(env.root.style.colorScheme, 'dark')
})

test('a queued theme update from a departed page cannot overwrite the restored choice', () => {
  const env = setup({ animate: true })
  env.button.dispatchEvent(new Event('click'))
  assert.equal(env.pending.length, 1)
  env.hide()
  env.save('light')
  env.show()
  env.pending[0]()
  assert.equal(env.root.dataset.theme, 'light')
  assert.equal(env.root.dataset.themeTransition, undefined)
  assert.equal(env.button.dataset.themeSwitching, undefined)
})

test('native restoration follows the system when no valid saved preference exists', () => {
  const env = setup({ saved: null, darkSystem: true })
  env.show()
  assert.equal(env.root.dataset.theme, 'dark')
})

test('an Astro swap removes old control and window/document callbacks', () => {
  const env = setup()
  env.swap()
  env.save('dark')
  env.show()
  env.activate()
  env.button.dispatchEvent(new Event('click'))
  assert.equal(env.root.dataset.theme, 'light')
  env.save(null)
  env.root.dataset.theme = 'dark'
  env.systemChange()
  assert.equal(env.root.dataset.theme, 'dark', 'old system-theme listener is also removed')
})
