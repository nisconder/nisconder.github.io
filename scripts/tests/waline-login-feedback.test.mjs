import assert from 'node:assert/strict'
import test from 'node:test'
import { createWalineLoginFeedback, getWalineLoginSignal } from '../../src/lib/waline-login-feedback.mjs'

const setup = () => {
  const messages = []
  const timers = new Map()
  let nextId = 0
  const feedback = createWalineLoginFeedback({
    onStatus: (message) => messages.push(message),
    schedule: (callback) => {
      const id = ++nextId
      timers.set(id, callback)
      return id
    },
    cancel: (id) => timers.delete(id),
  })
  return { feedback, messages, timers }
}

test('pending login explains the popup and reports a missing return without claiming success', () => {
  const { feedback, messages, timers } = setup()
  feedback.start()
  assert.match(messages.at(-1), /弹出的 Waline 窗口/)
  const callback = [...timers.values()][0]
  callback()
  assert.match(messages.at(-1), /尚未收到/)
  assert.doesNotMatch(messages.at(-1), /已连接/)
})

test('only observing the official signed-in UI reports a successful connection', () => {
  const { feedback, messages, timers } = setup()
  feedback.connected()
  assert.equal(messages.length, 0)
  feedback.start()
  feedback.connected()
  assert.equal(messages.at(-1), '留言账号已连接。')
  assert.equal(timers.size, 0)
})

test('a later retry replaces the pending timer', () => {
  const { feedback, timers } = setup()
  feedback.start()
  feedback.start()
  assert.equal(timers.size, 1)
})

test('Astro navigation cleanup prevents a stale timeout or login from updating the old page', () => {
  const { feedback, messages, timers } = setup()
  feedback.start()
  const staleCallback = [...timers.values()][0]
  feedback.dispose()
  assert.equal(timers.size, 0)
  staleCallback()
  feedback.connected()
  feedback.start()
  feedback.received(true)
  assert.equal(messages.length, 1)
})

test('a missing credential has a distinct recovery message and cannot report connected', () => {
  const { feedback, messages, timers } = setup()
  feedback.start()
  feedback.received(false)
  assert.match(messages.at(-1), /后台没有返回登录凭据/)
  assert.match(messages.at(-1), /退出后重新登录/)
  assert.equal(timers.size, 0)
})

test('a returned result without an official UI update offers a different recovery', () => {
  const { feedback, messages, timers } = setup()
  feedback.start()
  feedback.received(true)
  assert.match(messages.at(-1), /正在更新留言区/)
  ;[...timers.values()][0]()
  assert.match(messages.at(-1), /已收到登录结果，但留言区未更新/)
  assert.match(messages.at(-1), /复制尚未提交的留言/)
  assert.doesNotMatch(messages.at(-1), /已连接/)
})

test('the official signed-in UI cancels the post-message update timeout', () => {
  const { feedback, messages, timers } = setup()
  feedback.start()
  feedback.received(true)
  const staleCallback = [...timers.values()][0]
  feedback.connected()
  staleCallback()
  assert.equal(messages.at(-1), '留言账号已连接。')
  assert.equal(timers.size, 0)
})

test('messages outside the exact Waline origin or contract are ignored', () => {
  const serverOrigin = 'https://my-waline-pink.vercel.app'
  const data = { type: 'userInfo', data: { token: 'test-fixture-only' } }
  assert.equal(getWalineLoginSignal({ origin: 'https://example.org', data }, serverOrigin), null)
  assert.equal(getWalineLoginSignal({ origin: `${serverOrigin}.example.org`, data }, serverOrigin), null)
  assert.equal(getWalineLoginSignal({ origin: serverOrigin, data: { type: 'profile' } }, serverOrigin), null)
  assert.equal(getWalineLoginSignal({ origin: serverOrigin, data: null }, serverOrigin), null)
})

test('diagnostics expose only a boolean, never the userInfo payload or credential', () => {
  const origin = 'https://my-waline-pink.vercel.app'
  assert.equal(getWalineLoginSignal({ origin, data: { type: 'userInfo', data: { token: 'test-fixture-only' } } }, origin), true)
  for (const token of [undefined, null, '', 123]) {
    assert.equal(getWalineLoginSignal({ origin, data: { type: 'userInfo', data: { token } } }, origin), false)
  }
  assert.equal(getWalineLoginSignal({ origin, data: { type: 'userInfo' } }, origin), false)
})
