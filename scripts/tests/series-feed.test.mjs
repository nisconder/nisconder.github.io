import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import test from 'node:test'
import yaml from 'js-yaml'

const site = 'https://nisconder.pages.dev'
const fileUrl = path => new URL(`../../${path}`, import.meta.url)
const read = path => readFileSync(fileUrl(path), 'utf8')
const decodeXml = text => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name])
const frontmatter = path => {
  const match = read(path).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  assert.ok(match, `${path} contains YAML frontmatter`)
  return yaml.load(match[1])
}

// Preserve offsets while ignoring markup-like strings in CDATA article bodies.
const maskCdata = xml => xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, part => ' '.repeat(part.length))
const elements = (xml, name) => [...maskCdata(xml).matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'g'))]
  .map(match => xml.slice(match.index, match.index + match[0].length))
const elementText = (xml, name) => {
  const [element] = elements(xml, name)
  assert.ok(element, `RSS contains ${name}`)
  return decodeXml(element.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, ''))
}
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decodeXml(value)]))
const items = xml => elements(xml, 'item').map(item => ({
  link: elementText(item, 'link'),
  guid: elements(item, 'guid')[0],
  pubDate: elementText(item, 'pubDate'),
  content: elements(item, 'content:encoded')[0],
}))
const articleUrl = ({ id, data }) => {
  const date = new Date(data.date)
  const pad = value => String(value).padStart(2, '0')
  const slug = id.split('/').at(-1)
  return `${site}/${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${encodeURIComponent(slug)}/`
}

const posts = readdirSync(fileUrl('source/_posts/'), { recursive: true })
  .filter(path => path.endsWith('.md'))
  .map(path => ({ id: path.replace(/\\/g, '/').replace(/\.md$/, ''), data: frontmatter(`source/_posts/${path}`) }))
const postsById = new Map(posts.map(post => [post.id, post]))
// Read the author's list directly. Do not derive order from dates or the resolver.
const series = readdirSync(fileUrl('source/_series/'))
  .filter(path => path.endsWith('.md'))
  .map(path => {
    const data = frontmatter(`source/_series/${path}`)
    const chapters = (data.chapters ?? []).map(({ post: id }) => {
      assert.ok(postsById.has(id), `the source chapter ${id} exists`)
      return postsById.get(id)
    }).filter(post => post.data.draft !== true)
    return { id: path.replace(/\.md$/, ''), data, chapters }
  })
const publishedSeries = series.filter(entry => entry.data.draft !== true && entry.chapters.length > 0)
const globalItems = items(read('dist/rss.xml'))
const globalByLink = new Map(globalItems.map(item => [item.link, item]))

test('global RSS still includes every public article once in publication-date order', () => {
  assert.equal(globalByLink.size, globalItems.length, 'the global feed has no duplicate articles')
  assert.deepEqual(globalItems.map(item => item.link).sort(), posts.filter(post => post.data.draft !== true).map(articleUrl).sort())
  const dates = globalItems.map(item => Date.parse(item.pubDate))
  assert.ok(dates.every(Number.isFinite))
  assert.deepEqual(dates, [...dates].sort((left, right) => right - left), 'collection order does not reorder the global feed')
})

test('only public nonempty collections have generated RSS files', () => {
  const feedPaths = readdirSync(fileUrl('dist/series/'), { recursive: true })
    .map(path => path.replace(/\\/g, '/'))
    .filter(path => path.endsWith('/rss.xml'))
  assert.deepEqual(feedPaths.sort(), publishedSeries.map(entry => `${entry.id}/rss.xml`).sort())
  for (const entry of series.filter(entry => entry.data.draft === true || entry.chapters.length === 0)) {
    assert.equal(existsSync(fileUrl(`dist/series/${entry.id}/rss.xml`)), false, `${entry.id} stays private`)
  }
})

for (const entry of publishedSeries) {
  const path = `/series/${entry.id}/`
  const feedPath = `${path}rss.xml`

  test(`${entry.id} RSS contains exactly its published chapters in manual reading order`, () => {
    const xml = read(`dist${feedPath}`)
    const collectionItems = items(xml)
    assert.deepEqual(collectionItems.map(item => item.link), entry.chapters.map(articleUrl), 'source chapter order is authoritative, without sorting by article date')
    for (const item of collectionItems) {
      assert.ok(item.guid, `${item.link} retains an identity`)
      assert.ok(item.content?.includes('<![CDATA['), `${item.link} retains full HTML content`)
      assert.deepEqual(item, globalByLink.get(item.link), 'the same article retains its original GUID, publication date and full content across subscriptions')
    }
    const channel = xml.slice(0, maskCdata(xml).indexOf('<item>'))
    assert.equal(elementText(channel, 'link'), `${site}${path}`)
    assert.ok(elementText(channel, 'title').includes(entry.data.title))
    const selfLinks = [...channel.matchAll(/<atom:link\b[^>]*\/>/g)].map(([tag]) => attributes(tag))
    assert.deepEqual(selfLinks.filter(link => link.rel === 'self').map(link => [link.href, link.type]), [[`${site}${feedPath}`, 'application/rss+xml']])
  })

  test(`${entry.id} collection page discovers and visibly links to its own RSS`, () => {
    const html = read(`dist${path}index.html`)
    const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/)?.[1]
    assert.ok(head)
    const feeds = [...head.matchAll(/<link\b[^>]*>/g)].map(([tag]) => attributes(tag))
      .filter(link => link.rel === 'alternate' && link.type === 'application/rss+xml')
    assert.deepEqual(feeds.map(link => link.href), [`${site}${feedPath}`])
    const subscriptions = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .filter(([, attrs, label]) => new URL(attributes(attrs).href ?? '#', site).href === `${site}${feedPath}` && /RSS/i.test(label))
    assert.ok(subscriptions.length > 0, 'readers have a visible collection subscription link')
  })
}

test('home and general indexes continue to advertise the global RSS subscription', () => {
  for (const path of ['dist/index.html', 'dist/articles/index.html', 'dist/series/index.html']) {
    const head = read(path).match(/<head\b[^>]*>([\s\S]*?)<\/head>/)?.[1]
    assert.ok(head, `${path} contains document metadata`)
    const feeds = [...head.matchAll(/<link\b[^>]*>/g)].map(([tag]) => attributes(tag))
      .filter(link => link.rel === 'alternate' && link.type === 'application/rss+xml')
    assert.deepEqual(feeds.map(link => link.href), [`${site}/rss.xml`], path)
  }
})
