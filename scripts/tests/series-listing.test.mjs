import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import test from 'node:test'
import yaml from 'js-yaml'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const readFrontmatter = path => {
  const source = read(path)
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  assert.ok(frontmatter, `${path} must contain frontmatter`)
  return yaml.load(frontmatter[1])
}

// Read the author's independent chapter list, rather than reusing the listing
// filter under test. The same published URLs must survive this display change.
const collection = readFrontmatter('source/_series/ics-8086.md')
const chapters = collection.chapters.map(({ post: id }) => {
  const data = readFrontmatter(`source/_posts/${id}.md`)
  assert.notEqual(data.draft, true, `The existing ICS chapter ${id} remains public`)
  const date = new Date(data.date)
  const pad = value => String(value).padStart(2, '0')
  const url = `/${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${encodeURIComponent(id)}/`
  return { id, title: data.title, url }
})
assert.ok(chapters.length > 0, 'the ICS collection remains populated')
const chapterUrls = new Set(chapters.map(chapter => chapter.url))
const hrefs = html => [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/g)].map(match => match[1])
const articleBlocks = (html, className) => [...html.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)]
  .filter(([, attributes]) => new RegExp(`\\bclass="[^"]*\\b${className}\\b`).test(attributes))
  .map(([, , body]) => body)
const rejectChapterLinks = (html, label) => {
  for (const href of hrefs(html)) assert.ok(!chapterUrls.has(href), `${label} must not list chapter ${href}`)
}

test('homepage ordinary latest and pinned cards exclude ICS chapters while retaining the collection card', () => {
  const home = read('dist/index.html')
  const ordinaryCards = articleBlocks(home, 'article-panel')
  assert.ok(ordinaryCards.length > 0, 'ordinary published articles are still shown')
  ordinaryCards.forEach(card => rejectChapterLinks(card, 'The ordinary homepage cards'))
  const collectionCards = articleBlocks(home, 'series-card')
  assert.ok(collectionCards.some(card => hrefs(card).includes('/series/ics-8086/')), 'homepage retains the ICS collection entrance')
})

test('ordinary article rows and year archives exclude ICS chapters while retaining the collection entrance', () => {
  const articles = read('dist/articles/index.html')
  const ordinaryRows = articleBlocks(articles, 'post-row')
  assert.ok(ordinaryRows.length > 0, 'ordinary published article rows remain available')
  ordinaryRows.forEach(row => rejectChapterLinks(row, 'The ordinary article rows'))
  const yearArchives = [...articles.matchAll(/<section\b[^>]*class="[^"]*\byear-archive\b[^"]*"[^>]*>([\s\S]*?)<\/section>/g)]
  assert.ok(yearArchives.length > 0, 'the remaining articles still have a year archive')
  yearArchives.forEach(([, archive]) => rejectChapterLinks(archive, 'The year archive'))
  const collectionCards = articleBlocks(articles, 'series-card')
  assert.ok(collectionCards.some(card => hrefs(card).includes('/series/ics-8086/')), 'article index retains the ICS collection entrance')
})

test(`ICS collection retains all ${chapters.length} configured chapters in order and their existing article pages`, () => {
  const collectionPage = read('dist/series/ics-8086/index.html')
  const chapterList = collectionPage.match(/<ol\b[^>]*class="[^"]*\bseries-chapters\b[^"]*"[^>]*>([\s\S]*?)<\/ol>/)?.[1]
  assert.ok(chapterList, 'the public collection still has a chapter list')
  assert.deepEqual(hrefs(chapterList), chapters.map(chapter => chapter.url), 'the collection keeps every chapter in the configured order')

  for (const chapter of chapters) {
    const file = `dist${chapter.url}index.html`
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)), `${chapter.url} still resolves to a built article`)
    const html = read(file)
    assert.match(html, /<div\b[^>]*data-reading-body[^>]*>[\s\S]+?<\/div>/, `${chapter.id} retains its article body`)
    assert.ok(hrefs(html).includes('/series/ics-8086/'), `${chapter.id} links back to its collection`)
    assert.match(html, new RegExp(`<link\\b[^>]*rel="canonical"[^>]*href="[^\"]*${chapter.url}"`), 'the public chapter URL remains canonical')
  }
})

test('ICS chapters remain fully searchable after being removed from ordinary listings', () => {
  const index = JSON.parse(read('dist/search-index.json'))
  for (const chapter of chapters) {
    const indexed = index.find(item => item.kind === '文章' && item.url === chapter.url)
    assert.ok(indexed, `${chapter.id} remains in search`)
    assert.equal(indexed.title, chapter.title)
    assert.ok(indexed.content?.trim().length > 100, `${chapter.id} keeps its full-text search content`)
  }
})

test('ordinary articles no longer link to ICS through chronological previous and next navigation', () => {
  const ordinaryUrls = articleBlocks(read('dist/articles/index.html'), 'post-row')
    .flatMap(hrefs).filter(url => /^\/\d{4}\/\d{2}\/\d{2}\//.test(url))
  assert.ok(ordinaryUrls.length > 0)
  for (const url of new Set(ordinaryUrls)) {
    const html = read(`dist${url}index.html`)
    const chronologicalNavigation = html.match(/<nav\b[^>]*class="[^"]*\barticle-pagination\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? ''
    rejectChapterLinks(chronologicalNavigation, `The chronological navigation for ${url}`)
  }
})
