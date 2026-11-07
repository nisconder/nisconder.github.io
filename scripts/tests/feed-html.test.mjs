import assert from 'node:assert/strict'
import test from 'node:test'
import { absolutizeFeedHtml } from '../../src/lib/feed-html.mjs'

const postUrl = 'https://nisconder.pages.dev/2026/10/30/example/'
const convert = html => absolutizeFeedHtml(html, postUrl)

test('feed links resolve root, bare relative, parent, query, fragment and protocol-relative URLs', () => {
  const cases = [
    ['/series/ics-8086/', 'https://nisconder.pages.dev/series/ics-8086/'],
    ['images/example.png', `${postUrl}images/example.png`],
    ['./figure.png', `${postUrl}figure.png`],
    ['../next/', 'https://nisconder.pages.dev/2026/10/30/next/'],
    ['?mode=full', `${postUrl}?mode=full`],
    ['#section', `${postUrl}#section`],
    ['//cdn.example.com/image.png', 'https://cdn.example.com/image.png'],
  ]
  for (const [value, expected] of cases) {
    assert.equal(convert(`<a href="${value}">read</a>`), `<a href="${expected}">read</a>`)
    assert.equal(convert(`<img src="${value}">`), `<img src="${expected}">`)
  }
})

test('HTML entities are decoded once and escaped once without corrupting query parameters', () => {
  assert.equal(convert('<a href="/search/?q=ics&amp;type=article">'), '<a href="https://nisconder.pages.dev/search/?q=ics&amp;type=article">')
  assert.equal(convert('<a href="/search/?q=ics&#38;type=article&#x26;page=2">'), '<a href="https://nisconder.pages.dev/search/?q=ics&amp;type=article&amp;page=2">')
  assert.equal(convert('<a href="/search/?q=&amp;amp;">'), '<a href="https://nisconder.pages.dev/search/?q=&amp;amp;">')
  assert.equal(convert('<a href="/search/?q=&#38;amp;">'), '<a href="https://nisconder.pages.dev/search/?q=&amp;amp;">')
})

test('only real href and src attributes change, including single-quoted and unquoted values', () => {
  assert.equal(convert('<a title="a > b" HREF = \'../next/\'>'), '<a title="a > b" HREF = \'https://nisconder.pages.dev/2026/10/30/next/\'>')
  assert.equal(convert('<img src=images/photo.png data-src="/lazy.png" srcset="/small.png 1x">'), `<img src="${postUrl}images/photo.png" data-src="/lazy.png" srcset="/small.png 1x">`)
  const example = `<span data-example='href="/example/"' title='src="/image.png"'>href="/text/"</span>`
  assert.equal(convert(example), example)
})

test('escaped code, comments and raw-text elements retain literal link examples', () => {
  const code = '<pre><code>&lt;a href="/example/"&gt;read&lt;/a&gt;</code></pre>'
  const comment = '<!-- <img src="/comment.png"> -->'
  const script = '<script>const example = \'<a href="/example/">\';</script>'
  const textarea = '<textarea><img src="/literal.png"></textarea>'
  const style = '<style>/* <img src="/literal.png"> */</style>'
  const html = code + comment + script + textarea + style
  assert.equal(convert(html), html)
  assert.equal(convert(`${html}<img src="/real.png">`), `${html}<img src="https://nisconder.pages.dev/real.png">`)
})

test('absolute URLs, non-HTTP schemes and empty attributes remain unchanged', () => {
  const html = '<a href="https://example.com/?a=1&amp;b=2">absolute</a><a href="mailto:author@example.com">email</a><a href="tel:+861234">phone</a><img src="data:image/png;base64,abc"><a href=""></a><img src="">'
  assert.equal(convert(html), html)
})

test('normalizing a feed twice is idempotent', () => {
  const html = '<a href="/search/?q=ics&amp;type=article">read</a><img src="images/photo.png"><a href="//example.com/?q=1&#38;b=2">external</a>'
  const converted = convert(html)
  assert.equal(convert(converted), converted)
})
