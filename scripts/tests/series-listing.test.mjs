import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import test from 'node:test'
import yaml from 'js-yaml'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const readFrontmatter = path => {
  const source = read(path)
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  assert.ok(frontmatter, `${path} must contain frontmatter`)
  return yaml.load(frontmatter[1])
}

// Count the published source articles once, independently of collection membership.
// A chapter can belong to more than one collection without becoming another article.
const publishedPosts = readdirSync(new URL('../../source/_posts/', import.meta.url), { recursive: true })
  .filter(file => file.endsWith('.md'))
  .map(file => readFrontmatter(`source/_posts/${file.replace(/\\/g, '/')}`))
  .filter(data => data.draft !== true)

const countedLinks = (html, className) => {
  const navigation = html.match(new RegExp(`<nav\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/nav>`))?.[1]
  assert.ok(navigation, `${className} navigation is rendered`)
  const entries = [...navigation.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, body]) => {
    const count = body.match(/<small\b[^>]*>\s*(\d+)(?:\s*篇)?\s*<\/small>/)?.[1]
    assert.notEqual(count, undefined, `${href} displays its article count`)
    return [href.replace(/&amp;/g, '&'), Number(count)]
  })
  assert.equal(new Set(entries.map(([href]) => href)).size, entries.length, 'counted links are unique')
  return new Map(entries)
}

test('homepage article totals include published collection chapters', () => {
  const home = read('dist/index.html')
  const stats = home.match(/<dl\b[^>]*class="[^"]*\bidentity-panel__stats\b[^"]*"[^>]*>([\s\S]*?)<\/dl>/)?.[1]
  assert.ok(stats, 'homepage content statistics are rendered')
  const total = stats.match(/<dt\b[^>]*>\s*文章\s*<\/dt>\s*<dd\b[^>]*>\s*(\d+)\s*<\/dd>/)?.[1]
  assert.equal(Number(total), publishedPosts.length, 'homepage counts all published articles, including collection chapters')

  const archive = home.match(/<nav\b[^>]*class="[^"]*\bhome-articles__archive\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/)?.[1]
  assert.ok(archive, 'the complete article index remains accessible')
  const link = archive.match(/<a\b[^>]*href="\/articles\/"[^>]*>\s*全部\s+(\d+)\s+篇文章/)
  assert.ok(link, 'the article index link displays the total')
  assert.equal(Number(link[1]), publishedPosts.length)
})

test('article index total and category counts include published collection chapters', () => {
  const expected = new Map([['/articles/', publishedPosts.length]])
  for (const data of publishedPosts) {
    const category = Array.isArray(data.categories) ? data.categories[0] : data.categories
    if (!category) continue
    const href = `/search/?category=${encodeURIComponent(category)}`
    expected.set(href, (expected.get(href) ?? 0) + 1)
  }
  assert.deepEqual(countedLinks(read('dist/articles/index.html'), 'category-index'), expected)
})

test('article index topic counts include published collection chapters', () => {
  const categories = new Set(publishedPosts.map(data => Array.isArray(data.categories) ? data.categories[0] : data.categories))
  const expected = new Map()
  for (const data of publishedPosts) {
    for (const tag of data.tags ?? []) {
      if (!tag || categories.has(tag)) continue
      const href = `/search/?type=article&q=${encodeURIComponent(tag)}`
      expected.set(href, (expected.get(href) ?? 0) + 1)
    }
  }
  assert.deepEqual(countedLinks(read('dist/articles/index.html'), 'topic-index'), expected)
})

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
