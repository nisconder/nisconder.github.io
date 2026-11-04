import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

const source = readFileSync(resolve(import.meta.dirname, '../../source/admin/series-cards.js'), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const entries = (...ids) => ids.map(post => ({ post }))

function createWidget(value, fetcher) {
  let specification
  const calls = []
  const window = {
    CMS: { registerWidget(name, control) { assert.equal(name, 'seriescards'); specification = control } },
    createClass: spec => spec,
    h: () => null,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
  }
  vm.runInNewContext(source, { window, AbortController, fetch: fetcher })
  const widget = { props: { value, onChange(next) { calls.push(plain(next)); widget.props.value = next } }, alive: true }
  Object.keys(specification).forEach(key => { widget[key] = specification[key].bind(widget) })
  widget.state = widget.getInitialState()
  widget.setState = next => { widget.state = { ...widget.state, ...next } }
  return { widget, calls }
}

test('card movement saves only ordered post references and leaves original input untouched', () => {
  const original = entries('oldest', 'newest', 'draft-reference')
  const { widget, calls } = createWidget({ toJS: () => original })
  widget.moveCard(0, 2)
  assert.deepEqual(calls, [entries('newest', 'draft-reference', 'oldest')])
  assert.deepEqual(original, entries('oldest', 'newest', 'draft-reference'))
  widget.moveCard(2, 0)
  assert.deepEqual(calls[1], original)
})

test('boundary movements and duplicate additions do not edit the field', () => {
  const { widget, calls } = createWidget(entries('one', 'two'))
  widget.moveCard(0, -1)
  widget.moveCard(1, 2)
  widget.moveCard(0, 0)
  widget.addPost({ id: 'one', title: 'Existing' })
  assert.deepEqual(calls, [])
  widget.addPost({ id: 'three', title: 'New article' })
  assert.deepEqual(calls, [entries('one', 'two', 'three')])
})

test('removing a chapter preserves every other reference, including unavailable articles', () => {
  const { widget, calls } = createWidget(entries('public', 'unavailable', 'another'))
  widget.removeCard(0)
  assert.deepEqual(calls, [entries('unavailable', 'another')])
  assert.equal(widget.postInfo('unavailable').title, 'unavailable')
  assert.equal(widget.postInfo('unavailable').unresolved, true)
})

test('duplicate and empty references are rejected without silently dropping entries', () => {
  const duplicate = createWidget(entries('one', 'one')).widget
  assert.match(duplicate.isValid().error.message, /重复/)
  const invalid = createWidget([{ post: '' }, { post: 'keep' }]).widget
  assert.match(invalid.isValid().error.message, /未选择/)
  assert.deepEqual(plain(invalid.readValue()), entries('', 'keep'))
  assert.equal(createWidget([]).widget.isValid(), true)
})

test('canceling a drag or dropping a stale snapshot cannot overwrite newer editor changes', () => {
  const { widget, calls } = createWidget(entries('one', 'two'))
  widget.dragging = { signature: JSON.stringify(entries('one', 'two')), index: 0, target: 1 }
  widget.cancelDrag()
  assert.deepEqual(calls, [])
  assert.equal(widget.state.drag, null)
  widget.dragging = { signature: JSON.stringify(entries('one', 'two')), index: 0, target: 1 }
  widget.props.value = entries('one', 'two', 'newly-added')
  widget.finishDrag()
  assert.deepEqual(calls, [])
  assert.deepEqual(plain(widget.readValue()), entries('one', 'two', 'newly-added'))
})

test('a completed drag commits the exact target order through the CMS field callback', () => {
  const { widget, calls } = createWidget(entries('one', 'two', 'three'))
  widget.dragging = { signature: JSON.stringify(entries('one', 'two', 'three')), index: 2, target: 0 }
  widget.finishDrag()
  assert.deepEqual(calls, [entries('three', 'one', 'two')])
  assert.equal(widget.dragging, null)
})

test('canceling the parallel touch pointer stream does not cancel a TouchEvent drag', () => {
  const { widget, calls } = createWidget(entries('one', 'two'))
  widget.dragging = { signature: JSON.stringify(entries('one', 'two')), index: 0, target: 1, pointerId: 'touch' }
  widget.onPointerCancel({ pointerType: 'touch' })
  assert.equal(widget.dragging.pointerId, 'touch')
  widget.finishDrag()
  assert.deepEqual(calls, [entries('two', 'one')])
  widget.dragging = { signature: JSON.stringify(entries('two', 'one')), index: 0, target: 1, pointerId: 1 }
  widget.onPointerCancel({ pointerType: 'mouse' })
  assert.equal(widget.dragging, null)
  assert.equal(calls.length, 1)
})

test('metadata loads are read-only and never rewrite chapter references', async () => {
  const requests = []
  const { widget, calls } = createWidget(entries('old-draft-reference'), async (url, options) => {
    requests.push({ url, method: options.method || 'GET' })
    return { ok: true, json: async () => ({ posts: [
      { id: 'published', title: 'Published', description: 'Summary', draft: false },
      { id: 'published', title: 'Duplicate metadata' },
      { id: 'private', title: 'Draft', draft: true },
    ] }) }
  })
  widget.loadPosts()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(requests, [{ url: '/admin/post-options.json', method: 'GET' }])
  assert.deepEqual(plain(widget.state.posts), [{ id: 'published', title: 'Published', description: 'Summary' }])
  assert.deepEqual(plain(widget.readValue()), entries('old-draft-reference'))
  assert.deepEqual(calls, [])
})
