import assert from 'node:assert/strict'
import test from 'node:test'
import { normaliseSearch, prepareSearchRecords, readSearchState, searchRecords } from '../../src/lib/search-core.mjs'
import { createFullIndexLoader, createSearchSession, getCompactIndex } from '../../src/lib/search-client.mjs'

const state = (query = '', category = '', type = '') => ({ query, category, type })
const item = (url, data = {}) => ({ url, title: '笔记', kind: '文章', description: '', category: '技术', tags: [], date: '2026-01-01', ...data })
const results = (records, query, category = '', type = '') => searchRecords(prepareSearchRecords(records), state(query, category, type))
const response = (data, status = 200) => new Response(JSON.stringify(data), { status })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('search normalizes full-width Latin, case and Chinese without discarding the original display text', () => {
  assert.equal(normaliseSearch('ＩＣＳ 计算机'), 'ics 计算机')
  const entries = [item('/one/', { title: 'ICS 计算机系统' })]
  assert.equal(results(entries, 'ｉｃｓ 计算机').total, 1)
  assert.equal(results(entries, '计算机').matches[0].item.title, 'ICS 计算机系统')
})

test('multiple keywords require every token, while tokens may match different fields', () => {
  const entries = [item('/a/', { title: '汇编基础', tags: ['ICS'], content: '完整正文讨论栈帧' })]
  assert.equal(results(entries, '汇编 ICS 栈帧').total, 1)
  assert.equal(results(entries, '汇编 ICS 缺失').total, 0)
  assert.equal(results(entries, '  ICS   ICS  ').matches[0].score, 5)
})

test('full-text-only hits remain searchable even far beyond any excerpt', () => {
  const entries = [item('/deep/', { content: '普通内容'.repeat(10_000) + '稀有指令RET' })]
  assert.equal(results(entries, '稀有指令ret').total, 1)
})

test('title, tags, category and description retain their ranking priority over body-only hits', () => {
  const entries = [
    item('/body/', { content: '目标', date: '2099-01-01' }),
    item('/description/', { description: '目标' }),
    item('/category/', { category: '目标' }),
    item('/tags/', { tags: ['目标'] }),
    item('/title/', { title: '目标' }),
  ]
  assert.deepEqual(results(entries, '目标').matches.map(({ item }) => item.href), ['/title/', '/tags/', '/category/', '/description/', '/body/'])
})

test('category/type filtering and URL decoding keep article, collection and project scopes distinct', () => {
  const entries = [item('/article/'), item('/series/', { kind: '合集' }), item('/project/', { kind: '项目' })]
  assert.deepEqual(results(entries, '', '技术').matches.map(({ item }) => item.href), ['/article/'])
  assert.deepEqual(results(entries, '笔记', '', 'series').matches.map(({ item }) => item.href), ['/series/'])
  assert.deepEqual(results(entries, '', '', 'project').matches.map(({ item }) => item.href), ['/project/'])
  assert.deepEqual(readSearchState(new URLSearchParams('q=%E6%A0%88%E5%B8%A7&category=%E6%8A%80%E6%9C%AF&type=project')), state('栈帧', '技术', 'article'))
  assert.deepEqual(readSearchState(new URLSearchParams('q=abc&type=unknown')), state('abc'))
  assert.deepEqual(readSearchState(new URLSearchParams('type=article')), state('', '', 'article'))
})

test('true result count is separate from the display cap and ties use date then URL deterministically', () => {
  const entries = Array.from({ length: 30 }, (_, i) => item(`/a${String(i).padStart(2, '0')}/`)).reverse()
  const original = structuredClone(entries)
  const found = results(entries, '笔记')
  assert.equal(found.total, 30)
  assert.equal(found.matches.length, 20)
  assert.equal(found.matches[0].item.href, '/a00/')
  assert.deepEqual(entries, original)
  assert.equal(results([item('/old/'), item('/new/', { date: '2026-12-01' })], '笔记').matches[0].item.href, '/new/')
})

test('invalid remote links are rejected and index normalization is reused by content URL', () => {
  for (const url of ['javascript:alert(1)', '//other.example/', 'https://example.org/', '/\\example.org']) {
    assert.throws(() => prepareSearchRecords([item(url)]), /URL/)
  }
  const records = getCompactIndex('/test-catalog/a.json', [item('/one/')])
  assert.equal(getCompactIndex('/test-catalog/a.json', []), records)
  assert.notEqual(getCompactIndex('/test-catalog/b.json', [item('/one/')]), records)
})

test('concurrent pages share a full-index request and get the same normalized result', async () => {
  const pending = deferred()
  let fetches = 0
  const loader = createFullIndexLoader(() => { fetches += 1; return pending.promise })
  const a = loader.load('/hash.json')
  const b = loader.load('/hash.json')
  assert.equal(a, b)
  pending.resolve(response([item('/one/', { content: '全文' })]))
  const records = await a
  assert.equal(await b, records)
  assert.equal(loader.peek('/hash.json'), records)
  assert.equal(await loader.load('/hash.json'), records)
  assert.equal(fetches, 1)
})

test('metadata results appear synchronously and body hits are added after the full index arrives', async () => {
  const pending = deferred()
  const compact = prepareSearchRecords([item('/title/', { title: 'stack' }), item('/body/')])
  const output = []
  const session = createSearchSession({ compact, fullUrl: '/full.json', loader: createFullIndexLoader(() => pending.promise), onResults: value => output.push(value) })
  const completion = session.run(state('stack'))
  assert.equal(output.length, 1)
  assert.equal(output[0].pending, true)
  assert.deepEqual(output[0].matches.map(({ item }) => item.href), ['/title/'])
  pending.resolve(response([item('/title/', { title: 'stack' }), item('/body/', { content: 'stack' })]))
  await completion
  assert.equal(output[1].pending, false)
  assert.equal(output[1].total, 2)
})

test('empty query and category/type-only browsing never request article bodies', async () => {
  let fetches = 0
  const output = []
  const session = createSearchSession({ compact: prepareSearchRecords([item('/one/')]), fullUrl: '/full.json',
    loader: createFullIndexLoader(() => { fetches += 1; throw new Error('should not fetch') }), onResults: value => output.push(value) })
  await session.run(state())
  await session.run(state('', '技术'))
  await session.run(state('', '', 'article'))
  assert.equal(fetches, 0)
  assert.equal(output[0].total, 0)
  assert.equal(output[1].total, 1)
  assert.ok(output.every(value => !value.pending && !value.error))
})

test('an older query cannot replace newer results, including clearing the input during a request', async () => {
  const pending = deferred()
  const output = []
  const session = createSearchSession({ compact: prepareSearchRecords([item('/one/', { title: 'old' })]), fullUrl: '/full.json',
    loader: createFullIndexLoader(() => pending.promise), onResults: value => output.push(value) })
  const first = session.run(state('old'))
  const second = session.run(state('new'))
  await session.run(state())
  pending.resolve(response([item('/one/', { content: 'old new' })]))
  await Promise.all([first, second])
  assert.equal(output.length, 3)
  assert.deepEqual(output.at(-1).state, state())
})

test('composition invalidation and disposed pages suppress completion without cancelling shared work', async () => {
  const pending = deferred()
  const loader = createFullIndexLoader(() => pending.promise)
  const output = [], nextOutput = []
  const compact = prepareSearchRecords([item('/one/', { title: 'match' })])
  const first = createSearchSession({ compact, fullUrl: '/full.json', loader, onResults: value => output.push(value) })
  const firstDone = first.run(state('match'))
  first.invalidate()
  first.dispose()
  const next = createSearchSession({ compact, fullUrl: '/full.json', loader, onResults: value => nextOutput.push(value) })
  const nextDone = next.run(state('正文'))
  assert.equal(nextOutput[0].pending, true)
  assert.equal(nextOutput[0].total, 0, 'zero provisional hits are still pending')
  pending.resolve(response([item('/one/', { title: 'match', content: '正文' })]))
  await Promise.all([firstDone, nextDone])
  assert.equal(output.length, 1)
  assert.equal(nextOutput.length, 2)
  assert.equal(nextOutput[1].total, 1)
})

test('failed full-text loading preserves metadata matches and can be retried successfully', async () => {
  let fetches = 0
  const loader = createFullIndexLoader(async () => ++fetches === 1 ? response({}, 503) : response([item('/one/', { title: 'match' })]))
  const output = []
  const session = createSearchSession({ compact: prepareSearchRecords([item('/one/', { title: 'match' })]), fullUrl: '/full.json', loader, onResults: value => output.push(value) })
  await session.run(state('match'))
  assert.equal(output.at(-1).error, true)
  assert.equal(output.at(-1).total, 1)
  await session.run(state('match'))
  assert.equal(fetches, 2)
  assert.equal(output.at(-1).error, false)
  assert.equal(output.at(-1).pending, false)
})

test('a warmed full-text cache renders complete results immediately on SPA re-entry', async () => {
  const loader = createFullIndexLoader(async () => response([item('/body/', { content: '正文命中' })]))
  await loader.load('/full.json')
  const output = []
  const session = createSearchSession({ compact: prepareSearchRecords([item('/body/')]), fullUrl: '/full.json', loader, onResults: value => output.push(value) })
  await session.run(state('正文命中'))
  assert.equal(output.length, 1)
  assert.equal(output[0].total, 1)
  assert.equal(output[0].pending, false)
})

for (const stage of ['fetch', 'body']) {
  test(`a hanging ${stage} times out, retains compact results, and permits a clean retry`, async () => {
    const stalled = deferred()
    let requests = 0
    let originalSignal
    const loader = createFullIndexLoader((_url, options) => {
      requests += 1
      if (requests > 1) return response([item('/new/', { title: 'match', content: 'recovered' })])
      originalSignal = options.signal
      return stage === 'fetch' ? stalled.promise : Promise.resolve({ ok: true, json: () => stalled.promise })
    }, { timeoutMs: 15 })
    const output = []
    const session = createSearchSession({
      compact: prepareSearchRecords([item('/compact/', { title: 'match' })]),
      fullUrl: '/timeout.json', loader, onResults: value => output.push(value),
    })
    await session.run(state('match'))
    assert.equal(originalSignal.aborted, true)
    assert.equal(output.at(-1).error, true)
    assert.equal(output.at(-1).pending, false)
    assert.equal(output.at(-1).matches[0].item.href, '/compact/')
    assert.equal(loader.peek('/timeout.json'), undefined)

    await session.run(state('recovered'))
    assert.equal(requests, 2)
    assert.equal(output.at(-1).error, false)
    assert.equal(output.at(-1).matches[0].item.href, '/new/')
    const recoveredIndex = loader.peek('/timeout.json')
    // A late result from a transport that ignored abort cannot replace the
    // successful retry's cached index or repaint stale search results.
    const oldItems = [item('/stale/', { title: 'match' })]
    stalled.resolve(stage === 'fetch' ? response(oldItems) : oldItems)
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(loader.peek('/timeout.json'), recoveredIndex)
    assert.equal(output.at(-1).matches[0].item.href, '/new/')
  })
}
