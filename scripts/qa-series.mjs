// Exercise the real local build with an isolated browser. Never opens an
// authenticated browser or writes content through the production CMS.
// node scripts/qa-series.mjs --modules <existing node_modules> --url http://127.0.0.1:4321/
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import yaml from 'js-yaml'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const require = createRequire(option('--modules') ? resolve(option('--modules'), 'package.json') : import.meta.url)
const { chromium } = require('playwright')
const root = resolve(import.meta.dirname, '..')
const base = new URL(option('--url', 'http://127.0.0.1:4321/'))
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'QA only targets a local preview')
const output = resolve(root, '.deploy-series-qa')
await mkdir(output, { recursive: true })

async function contentFiles(folder) {
  const dir = resolve(root, folder)
  const found = []
  async function visit(path) {
    const entries = await readdir(path, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      const file = resolve(path, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.name.endsWith('.md')) {
        const source = await readFile(file, 'utf8')
        const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
        assert.ok(frontmatter, `${file} has frontmatter`)
        found.push({ id: relative(dir, file).replaceAll('\\', '/').replace(/\.md$/, ''), data: yaml.load(frontmatter[1]) })
      }
    }
  }
  await visit(dir)
  return found
}

const allPosts = await contentFiles('source/_posts')
const postById = new Map(allPosts.map(post => [post.id, post]))
const allSeries = await contentFiles('source/_series')
const series = allSeries.filter(entry => entry.data.draft !== true).map(entry => ({
  ...entry,
  href: `/series/${entry.id}/`,
  posts: (entry.data.chapters ?? []).map(chapter => {
    const post = postById.get(chapter.post)
    assert.ok(post, `${entry.id} refers to a real post: ${chapter.post}`)
    return post
  }).filter(post => post.data.draft !== true),
})).filter(entry => entry.posts.length > 0)
const postUrl = post => {
  const date = new Date(post.data.date)
  const pad = value => String(value).padStart(2, '0')
  return `/${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}/${encodeURIComponent(post.id.split('/').at(-1))}/`
}

const browser = await chromium.launch({ headless: true, channel: option('--channel', 'chrome') })
const results = []
const errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  async function visit(path) {
    const response = await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded' })
    assert.equal(response.status(), 200, `${path} responds successfully`)
    await page.locator('main').waitFor()
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
  }

  await visit('/series/')
  assert.equal(await page.locator('.series-card').count(), series.length, 'only nonempty public collections are listed')
  const indexLinks = await page.locator('.series-card a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  for (const entry of series) assert.ok(indexLinks.includes(entry.href), `${entry.id} has a collection card link`)
  const sitemap = await (await context.request.get(new URL('/sitemap.xml', base).href)).text()
  assert.ok(sitemap.includes('/series/'), 'sitemap includes collection index')
  for (const entry of series) {
    assert.ok(sitemap.includes(entry.href), `${entry.id} appears in sitemap`)
    await visit(entry.href)
    assert.equal((await page.locator('h1').innerText()).trim(), entry.data.title, 'collection keeps its full title')
    const chapterLinks = await page.locator('.series-chapters > li').evaluateAll(items => items.map(item => {
      const link = item.querySelector('a')
      return { href: link?.getAttribute('href'), text: link?.textContent }
    }))
    assert.deepEqual(chapterLinks.map(link => link.href), entry.posts.map(postUrl), `${entry.id} follows configured order`)
    for (const [index, post] of entry.posts.entries()) {
      assert.ok(chapterLinks[index].text?.includes(post.data.title), `${entry.id} keeps the complete chapter title`)
    }
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    assert.ok(canonical.endsWith(entry.href), 'collection has its own canonical URL')
    results.push({ collection: entry.id, chapters: chapterLinks.length, order: 'passed' })
  }
  for (const hidden of allSeries.filter(entry => !series.some(visible => visible.id === entry.id))) {
    assert.ok(!indexLinks.includes(`/series/${hidden.id}/`), `${hidden.id} is not linked publicly`)
    assert.ok(!sitemap.includes(`/series/${hidden.id}/`), `${hidden.id} is absent from sitemap`)
  }

  const firstSeries = series[0]
  const routes = ['/', '/articles/', '/series/', ...(firstSeries ? [firstSeries.href, postUrl(firstSeries.posts[0])] : [])]
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 375, 812]) {
      await page.setViewportSize({ width, height: width === 812 ? 375 : 1000 })
      for (const path of routes) {
        await visit(path)
        if (await page.locator('html').getAttribute('data-theme') !== theme) {
          await page.locator('[data-theme-toggle]').click()
          await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme)
        }
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
        assert.ok(geometry.document <= geometry.viewport + 1, `${path} has no ${theme} overflow at ${width}px`)
        const clippedTitles = await page.locator('.series-card h2, .series-card h3, .series-chapters h2, .series-chapters h3').evaluateAll(elements => elements.filter(element => {
          const css = getComputedStyle(element)
          return css.textOverflow === 'ellipsis' || (css.webkitLineClamp !== 'none' && css.webkitLineClamp !== '0')
        }).map(element => element.textContent))
        assert.deepEqual(clippedTitles, [], 'collection titles do not use truncation')
        const selectedNav = await page.getByRole('navigation', { name: '主要导航', exact: true }).locator('[aria-current="page"]').allTextContents()
        if (path.startsWith('/series/')) assert.deepEqual(selectedNav.map(label => label.trim()), ['合集'])
        if (width !== 812) {
          const name = path === '/' ? 'home' : path.replaceAll('/', '-').replace(/^-|-$/g, '')
          await page.screenshot({ path: resolve(output, `${name}-${theme}-${width}.png`), fullPage: path.startsWith('/series/') })
        }
        results.push({ path, theme, width, ...geometry })
      }
    }
  }

  // Exercise ClientRouter, theme persistence, and native disclosure through real clicks.
  await page.setViewportSize({ width: 375, height: 1000 })
  await visit('/articles/')
  await page.getByRole('navigation', { name: '主要导航', exact: true }).getByRole('link', { name: '合集', exact: true }).click()
  await page.waitForURL(new URL('/series/', base).href)
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark', 'theme survives collection navigation')
  if (firstSeries) {
    await page.locator(`.series-card a[href="${firstSeries.href}"]`).first().click()
    await page.waitForURL(new URL(firstSeries.href, base).href)
    await page.locator('.series-chapters > li a').first().click()
    await page.waitForURL(new URL(postUrl(firstSeries.posts[0]), base).href)
    assert.ok(await page.locator('.series-navigation').count(), 'article shows collection membership')
    const disclosure = page.locator('.series-navigation details').first()
    if (await disclosure.count()) {
      await disclosure.locator('summary').click()
      assert.ok(await disclosure.getAttribute('open') !== null, 'mobile collection contents can be expanded')
      const tocLinks = await disclosure.locator('a').evaluateAll(links => links.map(link => link.getAttribute('href')))
      for (const post of firstSeries.posts) assert.ok(tocLinks.includes(postUrl(post)), 'expanded article contents links every chapter')
    }
    if (firstSeries.posts.length > 1) {
      const next = postUrl(firstSeries.posts[1])
      const nextLink = page.locator(`.series-pagination a[href="${next}"]`)
      assert.ok(await nextLink.count(), 'first chapter points to the second configured chapter')
      await nextLink.first().click()
      await page.waitForURL(new URL(next, base).href)
      assert.ok(await page.locator(`.series-pagination a[href="${postUrl(firstSeries.posts[0])}"]`).count(), 'second chapter points back to the first')
      await page.goBack()
      await page.waitForURL(new URL(postUrl(firstSeries.posts[0]), base).href)
      assert.ok(await page.locator('.series-navigation').count(), 'back navigation restores collection UI')
    }
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  const report = { results, errors, interactions: 'passed', screenshots: output }
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser.close()
}
