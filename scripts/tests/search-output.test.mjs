import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import yaml from 'js-yaml'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const html = read('dist/search/index.html')
const embedded = html.match(/<script\b(?=[^>]*\bdata-search-catalog\b)[^>]*>([\s\S]*?)<\/script>/)?.[1]
assert.ok(embedded, 'the built search page contains its immediate metadata catalog')
const compact = JSON.parse(embedded)
const fullJson = read(`dist${compact.fullUrl}`)
const full = JSON.parse(fullJson)

test('the immediate metadata catalog excludes article bodies and has a matching immutable full index', () => {
  assert.match(compact.fullUrl, /^\/search-data\/[a-f0-9]{24}\.json$/)
  const version = createHash('sha256').update(fullJson).digest('hex').slice(0, 24)
  assert.equal(compact.fullUrl, `/search-data/${version}.json`)
  assert.deepEqual(compact.items, full.map(({ content, ...metadata }) => metadata))
  assert.ok(compact.items.every(item => !('content' in item)))
  assert.deepEqual(JSON.parse(read('dist/search-index.json')), full, 'legacy full-index endpoint keeps its array contract')
})

test('the public search index includes every public article and no draft article', () => {
  const paths = readdirSync(new URL('../../source/_posts/', import.meta.url), { recursive: true })
    .filter(path => path.endsWith('.md'))
  const publishedUrls = []
  for (const path of paths) {
    const source = read(`source/_posts/${path}`)
    const data = yaml.load(source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '')
    const date = new Date(data.date)
    const pad = value => String(value).padStart(2, '0')
    const slug = path.replace(/\\/g, '/').split('/').at(-1).replace(/\.md$/, '')
    const url = `/${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${encodeURIComponent(slug)}/`
    if (data.draft === true) {
      assert.ok(!full.some(item => item.url === url), `${path} is excluded from full text`)
      assert.ok(!compact.items.some(item => item.url === url), `${path} is excluded from the immediate catalog`)
    } else publishedUrls.push(url)
  }
  assert.deepEqual(full.filter(item => item.kind === '文章').map(item => item.url).sort(), publishedUrls.sort())
})

