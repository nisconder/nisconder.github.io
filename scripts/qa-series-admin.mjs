// Real Decap UI against the local, disposable test-repo preview only.
// First start: ADMIN_PREVIEW_PORT=4342 node scripts/preview-admin.mjs
// Then: node scripts/qa-series-admin.mjs --modules <node_modules> --url http://127.0.0.1:4342/
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const require = createRequire(resolve(option('--modules', './node_modules'), 'package.json'))
const { chromium } = require('playwright')
const base = new URL(option('--url', 'http://127.0.0.1:4342/'))
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Only local test-repo previews are allowed')
const config = await fetch(new URL('/admin/config.yml', base)).then(response => response.text())
assert.match(config, /^  name: test-repo$/m, 'Never save through the GitHub backend in browser QA')
const output = resolve('.deploy-series-qa')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const entry = option('--entry', 'ics-8086')
const chapterIDs = text => [...text.matchAll(/^\s*-\s*post:\s*['"]?([^'"\r\n]+)['"]?\s*$/gm)].map(match => match[1].trim())
const savedContent = () => page.evaluate(slug => window.repoFiles.source._series[`${slug}.md`].content, entry)
try {
  await page.goto(new URL(`/admin/content/#/collections/series/entries/${entry}`, base).href, { waitUntil: 'networkidle' })
  const login = page.getByRole('button', { name: /login|登录/i })
  await login.waitFor({ state: 'visible', timeout: 30000 })
  await login.click()
  await page.locator('[data-admin-form="series"]').waitFor({ timeout: 30000 })
  const before = chapterIDs(await savedContent())
  assert.ok(before.length >= 2, 'Seed at least two existing articles to test reorder')
  const layouts = []
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.screenshot({ path: resolve(output, `admin-series-${width}.png`) })
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }))
    layouts.push(dimensions)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  const chapters = page.locator('[data-admin-series-field="chapters"]')
  let handles = chapters.locator('[aria-roledescription="sortable"]')
  if (await handles.count() < 2) handles = chapters.locator('[class*="DragHandle"]')
  assert.ok(await handles.count() >= 2, 'Decap must expose reorder handles')
  await handles.nth(1).scrollIntoViewIfNeeded()
  const first = await handles.nth(0).boundingBox()
  const second = await handles.nth(1).boundingBox()
  assert.ok(first && second)
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(first.x + first.width / 2 + 8, first.y + first.height / 2, { steps: 3 })
  await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2 + 15, { steps: 20 })
  await page.mouse.up()
  await page.getByText('含未保存的修改', { exact: true }).waitFor()
  const publish = page.locator('span[role="button"][class*="PublishButton"]').first()
  await page.waitForFunction(() => [...document.querySelectorAll('span[role="button"]')].some(element => element.className.includes('PublishButton') && element.textContent.trim() === '发布'))
  if (await publish.count()) await publish.click()
  else await page.getByRole('button', { name: '发布', exact: true }).first().click()
  const confirm = page.getByText(/^(立即发布|现在发布|Publish now)$/i)
  await confirm.waitFor({ state: 'visible', timeout: 10000 })
  await confirm.click()
  await page.waitForFunction(({ slug, firstID }) => {
    const content = window.repoFiles.source._series[`${slug}.md`].content
    return content.match(/^\s*-\s*post:\s*([^\r\n]+)/m)?.[1].replace(/["']/g, '').trim() !== firstID
  }, { slug: entry, firstID: before[0] }, { timeout: 10000 })
  const after = chapterIDs(await savedContent())
  assert.deepEqual(after, [before[1], before[0], ...before.slice(2)], 'Saved YAML must preserve the new reading order')
  await page.screenshot({ path: resolve(output, 'admin-series-reordered.png') })
  await page.locator('a[href="#/collections/series"]').first().click()
  await page.locator('[data-admin-page="collection"][data-admin-collection="series"]').waitFor()
  await page.getByRole('link', { name: '新建合集', exact: true }).waitFor()
  const tabs = page.getByRole('navigation', { name: '内容类型', exact: true })
  await tabs.getByRole('link', { name: '文章', exact: true }).click()
  await page.locator('[data-admin-page="collection"][data-admin-collection="posts"]').waitFor()
  await tabs.getByRole('link', { name: '合集', exact: true }).click()
  await page.locator('[data-admin-page="collection"][data-admin-collection="series"]').waitFor()
  const createSeries = page.getByRole('link', { name: '新建合集', exact: true })
  assert.match(await createSeries.evaluate(element => getComputedStyle(element, '::after').content), /新建合集/)
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.screenshot({ path: resolve(output, `admin-series-list-${width}.png`) })
    layouts.push(await page.evaluate(() => ({ width:document.documentElement.scrollWidth, viewport:innerWidth })))
  }
  for (const dimensions of layouts) assert.ok(dimensions.width <= dimensions.viewport + 1, `Series editor overflows: ${JSON.stringify(dimensions)}`)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ layouts, reorderAndSave: 'passed', before: before.slice(0, 2), after: after.slice(0, 2), screenshots: output }, null, 2))
} catch (error) {
  await page.screenshot({ path: resolve(output, 'admin-series-failure.png') }).catch(() => {})
  console.error((await page.locator('body').innerText().catch(() => 'No document')).slice(0, 4000))
  console.error(JSON.stringify({ errors, buttons: await page.getByRole('button').allTextContents().catch(() => []) }))
  console.error(await page.evaluate(() => ({ toolbar:document.querySelector('[data-admin-series-toolbar]')?.outerHTML.slice(0, 6500), overflow:[...document.querySelectorAll('#nc-root *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map(element => ({ tag:element.tagName, class:element.className, width:element.getBoundingClientRect().width, minWidth:getComputedStyle(element).minWidth })) })).catch(() => []))
  throw error
} finally {
  await browser.close()
}
