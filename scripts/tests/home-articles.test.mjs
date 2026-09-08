import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../../src/pages/index.astro', import.meta.url), 'utf8')
const selection = source.slice(source.indexOf('const latestPost ='), source.indexOf('const topicCounts ='))
assert.ok(selection.includes('const homeArticles ='))

const selectArticles = (posts, pinned) => vm.runInNewContext(
  `(async () => { ${selection}; return homeArticles })()`,
  { posts, getPinnedPost: async () => pinned },
)

test('the latest article stays first and a different pinned article is a peer entry', async () => {
  const latest = { id: 'latest', data: { title: 'New article' } }
  const pinned = { id: 'pinned', data: { title: 'Editorial choice' } }
  const entries = await selectArticles([latest, pinned], pinned)
  assert.equal(entries.length, 2)
  assert.equal(entries[0].post, latest)
  assert.equal(entries[0].kind, 'latest')
  assert.equal(entries[1].post, pinned)
  assert.equal(entries[1].kind, 'pinned')
})

test('one article filling both roles appears once with both labels', async () => {
  const latest = { id: 'latest', data: { title: 'Latest and pinned' } }
  const entries = await selectArticles([latest, { id: 'older' }], latest)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].post, latest)
  assert.equal(entries[0].label, '最新文章 · 置顶')
})

test('no pinned article does not invent a second entry; no posts remains empty', async () => {
  const latest = { id: 'latest' }
  const entries = await selectArticles([latest, { id: 'older' }], undefined)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].post, latest)
  assert.equal((await selectArticles([], undefined)).length, 0)
})

test('built homepage has separate complete article entries, not a nested recommendation', () => {
  // Run the Astro build first so this checks actual output, not just source text.
  const html = readFileSync(new URL('../../dist/index.html', import.meta.url), 'utf8')
  const entriesSection = html.match(/<section\b[^>]*class="home-articles"[^>]*>([\s\S]*?)<\/section>/)?.[1]
  assert.ok(entriesSection, 'the articles share a section outside the personal introduction')
  assert.ok(!entriesSection.includes('<aside'))
  const articles = [...entriesSection.matchAll(/<article\b[^>]*class="([^"]*article-panel[^"]*)"[^>]*>([\s\S]*?)<\/article>/g)]
  assert.ok(articles.length >= 1 && articles.length <= 2, 'show at most the latest and one editorial choice')
  const links = []
  for (const [, , content] of articles) {
    assert.ok(!content.includes('<article'), 'one article must not contain another')
    const title = content.match(/<h2\b[^>]*>\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>/)
    assert.ok(title, 'each card has a complete linked h2')
    assert.ok(content.includes('<time '), 'each card has its own publication date')
    assert.match(content, /<p\b[^>]*>[^<]+<\/p>/, 'each card has its own description')
    assert.match(content, /class="primary-link"/, 'each card has its own reading action')
    links.push(title[1])
  }
  assert.equal(new Set(links).size, articles.length, 'the featured cards do not repeat one article')
})

test('both cards share typography and switch from equal desktop columns to one mobile column', () => {
  assert.match(source, /\.home-articles\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(source, /@media \(max-width: 52rem\)\s*\{\s*\.home-articles,[^{]*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
  const headingRule = source.match(/\.article-panel h2\s*\{([^}]+)\}/)?.[1]
  assert.ok(headingRule)
  assert.match(headingRule, /overflow-wrap:\s*anywhere/)
  assert.ok(!/ellipsis|line-clamp|nowrap/.test(headingRule))
  assert.ok(!source.includes('latest-panel__pinned'))
  assert.ok(!source.includes('.article-panel--pinned h2'), 'the pinned heading is not made smaller')
})
