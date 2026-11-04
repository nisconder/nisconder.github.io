import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { resolvePublishedSeries } from '../../src/lib/series-order.mjs'

const post = (id, data = {}) => ({
  id,
  data: { title: id, date: new Date('2026-01-01'), ...data },
})
const series = (id, chapters, data = {}) => ({
  id,
  data: { title: id, description: `${id} description`, chapters: chapters.map((post) => ({ post })), ...data },
})
const ids = (entry) => entry.posts.map((post) => post.id)

test('reading order follows the chapter list independently of dates, sticky weights, or source order', () => {
  const posts = [
    post('newest', { date: new Date('2026-11-01'), sticky: 10 }),
    post('oldest', { date: new Date('2025-01-01'), sticky: false }),
    post('middle', { date: new Date('2026-06-01'), sticky: true }),
  ]
  const [first] = resolvePublishedSeries([series('ics', ['middle', 'oldest', 'newest'])], posts)
  assert.deepEqual(ids(first), ['middle', 'oldest', 'newest'])
  const [reordered] = resolvePublishedSeries([series('ics', ['newest', 'middle', 'oldest'])], posts)
  assert.deepEqual(ids(reordered), ['newest', 'middle', 'oldest'])
  assert.equal(reordered.posts[1], posts[2], 'references retain the original article identity')
  assert.equal(reordered.href, '/series/ics/')
})

test('resolving and sorting never mutate article dates, source arrays, or chapter lists', () => {
  const posts = [post('second'), post('first')]
  const entries = [series('z-series', ['first', 'second']), series('a-series', ['second'])]
  const original = structuredClone({ entries, posts })
  for (const entry of entries) {
    entry.data.chapters.forEach(Object.freeze)
    Object.freeze(entry.data.chapters)
    Object.freeze(entry.data)
    Object.freeze(entry)
  }
  posts.forEach((entry) => { Object.freeze(entry.data); Object.freeze(entry) })
  Object.freeze(entries)
  Object.freeze(posts)
  resolvePublishedSeries(entries, posts)
  assert.deepEqual({ entries, posts }, original)
})

test('draft chapters resolve but stay private, preserving the visible sequence around them', () => {
  const posts = [post('first'), post('private', { draft: true }), post('last', { draft: false })]
  const [visible] = resolvePublishedSeries([series('ics', ['first', 'private', 'last'])], posts)
  assert.deepEqual(ids(visible), ['first', 'last'])
  // The public sequence is also the source for previous / next chapter links.
  assert.equal(visible.posts[visible.posts.findIndex((entry) => entry.id === 'last') - 1].id, 'first')
})

test('draft series, empty series, and series consisting only of draft posts stay private', () => {
  const posts = [post('published'), post('draft', { draft: true })]
  assert.deepEqual(resolvePublishedSeries([
    series('hidden', ['published'], { draft: true }),
    series('empty', []),
    series('no-public-chapters', ['draft']),
  ], posts), [])
  assert.deepEqual(resolvePublishedSeries([], []), [])
})

test('missing references fail with the collection and article names, including references in drafts', () => {
  for (const draft of [false, true]) {
    assert.throws(() => resolvePublishedSeries([
      series('ics', ['missing-post'], { title: '计算机系统', draft }),
    ], []), /合集「计算机系统」引用的文章不存在：missing-post/)
  }
})

test('duplicate chapter references fail while one article may belong to multiple collections', () => {
  const posts = [post('shared'), post('draft', { draft: true })]
  for (const id of ['shared', 'draft']) {
    assert.throws(() => resolvePublishedSeries([series('ics', [id, id])], posts), /重复收录了文章/)
  }
  const result = resolvePublishedSeries([series('first', ['shared']), series('second', ['shared'])], posts)
  assert.equal(result.length, 2)
  assert.ok(result.every((entry) => entry.posts[0] === posts[0]))
})

test('collection filenames are safe, stable lowercase path segments', () => {
  const posts = [post('chapter')]
  for (const id of ['ICS', '../ics', 'nested/ics', 'ics_test', '-ics', 'ics-', 'ics--notes', 'ics?draft', '']) {
    assert.throws(() => resolvePublishedSeries([series(id, ['chapter'])], posts), /文件名无效/)
  }
  assert.equal(resolvePublishedSeries([series('ics-8086', ['chapter'])], posts)[0].href, '/series/ics-8086/')
  assert.throws(() => resolvePublishedSeries([
    series('ics', ['chapter']), series('ics', ['chapter']),
  ], posts), /合集 ID 重复：ics/)
})

test('the collection listing sorts by title with an ID tie breaker, never by chapter dates', () => {
  const result = resolvePublishedSeries([
    series('b', ['older'], { title: 'Same title' }),
    series('c', ['newer'], { title: 'Another title' }),
    series('a', ['newer'], { title: 'Same title' }),
  ], [post('newer', { date: new Date('2026-11-01') }), post('older', { date: new Date('2025-01-01') })])
  assert.deepEqual(result.map((entry) => entry.id), ['c', 'a', 'b'])
})

test('imported ICS notes link to the live collection without overriding its configurable sequence', () => {
  const postDirectory = new URL('../../source/_posts/', import.meta.url)
  const files = readdirSync(postDirectory).filter((name) => /^ics-8086-.*\.md$/.test(name))
  assert.equal(files.length, 18)
  for (const file of files) {
    const markdown = readFileSync(new URL(file, postDirectory), 'utf8')
    assert.doesNotMatch(markdown, /\[(?:上一篇|下一篇)\]\([^)]*\)|^- (?:上一篇|下一篇)：\[/m, file)
    assert.match(markdown, /^> \[合集目录\]\(\/series\/ics-8086\/\)\r?$/m, file)
    assert.match(markdown, /## 系列导航\r?\n\r?\n- \[合集目录\]\(\/series\/ics-8086\/\)/, file)
    assert.doesNotMatch(markdown, /\[系列导读与完整目录\]/, file)
  }
})
