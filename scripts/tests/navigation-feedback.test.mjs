import test from 'node:test'
import assert from 'node:assert/strict'
import { installNavigationFeedback } from '../../src/lib/navigation-feedback.mjs'

function fixture() {
  const document = new EventTarget()
  const attributes = new Map()
  const status = { textContent: '' }
  document.documentElement = {
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
  }
  document.querySelector = () => status
  const jobs = new Map()
  let id = 0
  const timers = {
    setTimeout: (callback) => { jobs.set(++id, callback); return id },
    clearTimeout: (key) => jobs.delete(key),
  }
  const cleanup = installNavigationFeedback(document, timers)
  const start = (loader) => {
    const controller = new AbortController()
    const event = new Event('astro:before-preparation')
    Object.assign(event, { signal: controller.signal, loader })
    document.dispatchEvent(event)
    return { event, controller }
  }
  return {
    document, attributes, status, start, cleanup,
    tick: () => {
      const pending = [...jobs.values()]
      jobs.clear()
      pending.forEach((job) => job())
    },
  }
}

test('fast navigation has no flash or live announcement', async () => {
  const f = fixture()
  const { event } = f.start(async () => 'ready')
  assert.equal(await event.loader(), 'ready')
  f.tick()
  assert.equal(f.attributes.size, 0)
  assert.equal(f.status.textContent, '')
  f.cleanup()
})

test('slow navigation announces waiting then clears on completion', async () => {
  const f = fixture()
  const { event } = f.start(async () => 'ready')
  f.tick()
  assert.ok(f.attributes.has('data-navigation-loading'))
  assert.equal(f.status.textContent, '正在打开页面…')
  await event.loader()
  assert.equal(f.attributes.size, 0)
  assert.equal(f.status.textContent, '')
})

test('failure and aborted navigation clear feedback without swallowing errors', async () => {
  const f = fixture()
  const failure = f.start(async () => { throw new Error('offline') })
  f.tick()
  await assert.rejects(failure.event.loader(), /offline/)
  assert.equal(f.attributes.size, 0)
  const cancelled = f.start(async () => {})
  f.tick()
  cancelled.controller.abort()
  assert.equal(f.attributes.size, 0)
})

test('an old request cannot clear the newer request feedback', async () => {
  const f = fixture()
  let finishFirst
  const first = f.start(() => new Promise((resolve) => { finishFirst = resolve }))
  const firstLoad = first.event.loader()
  const second = f.start(async () => {})
  f.tick()
  finishFirst()
  await firstLoad
  first.controller.abort()
  assert.ok(f.attributes.has('data-navigation-loading'))
  await second.event.loader()
  assert.equal(f.attributes.size, 0)
})

test('abort before the delay and disposal cannot leave pending indicators', () => {
  const f = fixture()
  const { controller } = f.start(async () => {})
  controller.abort()
  f.tick()
  assert.equal(f.attributes.size, 0)
  f.start(async () => {})
  f.cleanup()
  f.tick()
  assert.equal(f.attributes.size, 0)
})

test('an older DOM swap restores feedback for the newer pending navigation', async () => {
  const f = fixture()
  const { event } = f.start(async () => {})
  f.tick()
  f.attributes.clear()
  const newStatus = { textContent: '' }
  f.document.querySelector = () => newStatus
  f.document.dispatchEvent(new Event('astro:after-swap'))
  assert.ok(f.attributes.has('data-navigation-loading'))
  assert.equal(newStatus.textContent, '正在打开页面…')
  await event.loader()
  assert.equal(f.attributes.size, 0)
  assert.equal(newStatus.textContent, '')
})
