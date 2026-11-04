// Real Decap UI against the loopback, disposable test-repo preview only.
// ADMIN_PREVIEW_PORT=4342 node scripts/preview-admin.mjs
// node scripts/qa-series-admin.mjs --modules <node_modules> --url http://127.0.0.1:4342/
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const require = createRequire(resolve(option('--modules', './node_modules'), 'package.json'))
const { chromium } = require('playwright')
const base = new URL(option('--url', 'http://127.0.0.1:4342/'))
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Only loopback test-repo previews are allowed')
const config = await fetch(new URL('/admin/config.yml', base)).then(response => response.text())
assert.match(config, /^\s+name: test-repo\s*$/m, 'Never save through the GitHub backend in browser QA')
assert.doesNotMatch(config, /^\s+name:\s*(github|gitlab|git-gateway)\s*$/m)
const options = await fetch(new URL('/admin/post-options.json', base)).then(response => response.json())
const titles = new Map(options.posts.map(post => [post.id, post.title]))

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, '.deploy-series-qa')
const entry = option('--entry', 'ics-8086')
assert.match(entry, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const sourcePath = resolve(root, 'source/_series', `${entry}.md`)
const originalSource = await readFile(sourcePath, 'utf8')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const errors = []
const blockedWrites = []
const results = []
const chapterIDs = text => [...text.matchAll(/^\s*-\s*post:\s*['"]?([^'"\r\n]+)['"]?\s*$/gm)].map(match => match[1].trim())
const originalOrder = chapterIDs(originalSource)
assert.ok(originalOrder.length >= 3, 'Seed at least three existing chapters')
const cardSelector = '[data-series-card][data-post-id]'
let activePage

async function createPage(mobile) {
  const context = await browser.newContext({ viewport: { width: mobile ? 375 : 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' })
  // A configuration regression cannot send a write to a real service.
  // CDN reads remain available for the pinned Decap application.
  await context.route('**/*', async route => {
    const request = route.request()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      const target = new URL(request.url())
      blockedWrites.push({ method: request.method(), origin: target.origin, path: target.pathname })
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const page = await context.newPage()
  activePage = page
  page.on('pageerror', error => errors.push(error.message))
  // Only the browser beforeunload prompt is accepted when discarding an edit.
  // This can never approve an application publish operation.
  page.on('dialog', async dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss())
  return { context, page }
}

const savedContent = page => page.evaluate(slug => window.repoFiles.source._series[`${slug}.md`].content, entry)
const displayedOrder = page => page.locator(cardSelector).evaluateAll(cards => cards.map(card => card.getAttribute('data-post-id')))

async function waitForEditor(page) {
  await page.waitForFunction(() => document.querySelector('[data-series-cards]') || [...document.querySelectorAll('button')].some(button => /login|登录/i.test(button.textContent)), null, { timeout: 30000 })
  const login = page.getByRole('button', { name: /login|登录/i })
  if (await login.isVisible()) await login.click()
  await page.locator('[data-series-cards]').waitFor({ timeout: 30000 })
  await page.waitForFunction(({ selector, count }) => document.querySelectorAll(selector).length === count, { selector: cardSelector, count: originalOrder.length })
}

async function openEditor(page) {
  await page.goto(new URL(`/admin/content/#/collections/series/entries/${entry}`, base).href, { waitUntil: 'networkidle' })
  await waitForEditor(page)
  assert.deepEqual(await displayedOrder(page), originalOrder, 'a fresh test repository uses the source order')
  assert.deepEqual(chapterIDs(await savedContent(page)), originalOrder)
}

async function expectOrder(page, expected) {
  await page.waitForFunction(({ selector, expected }) => JSON.stringify([...document.querySelectorAll(selector)].map(card => card.getAttribute('data-post-id'))) === JSON.stringify(expected), { selector: cardSelector, expected })
  assert.deepEqual(await displayedOrder(page), expected)
}

async function inspectLayout(page, name) {
  await page.locator(cardSelector).first().evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await page.evaluate(() => window.scrollBy(0, -160))
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }))
  assert.ok(dimensions.width <= dimensions.viewport + 1, `${name} overflows: ${JSON.stringify(dimensions)}`)
  assert.equal(await page.locator(cardSelector).count(), originalOrder.length)
  const cards = await page.locator(cardSelector).evaluateAll(elements => elements.map(element => ({ id: element.dataset.postId, title: element.querySelector('.series-cards__title')?.textContent })))
  for (const card of cards) assert.equal(card.title, titles.get(card.id), 'cards display the complete article title')
  await page.screenshot({ path: resolve(output, `${name}.png`) })
  results.push({ scenario: name, ...dimensions })
}

async function dragFirstBelowSecond(page, touch, cancel = false) {
  const cards = page.locator(cardSelector)
  const handle = cards.first().locator('[data-series-drag]')
  await handle.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }))
  const source = await handle.boundingBox()
  const target = await cards.nth(1).boundingBox()
  assert.ok(source && target, 'two visible cards and their drag handles are required')
  const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const end = { x: start.x, y: target.y + target.height * 0.7 }
  assert.ok(end.y < 990 && start.y > 0, `both drag positions must be in the viewport: ${JSON.stringify({ start, end })}`)
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    const points = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(start.x, start.y) })
    // Intentional long press: the widget preserves short gestures for scrolling.
    await new Promise(resolve => setTimeout(resolve, 280))
    for (let step = 1; step <= 20; step++) {
      const progress = step / 20
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(start.x + (end.x - start.x) * progress, start.y + (end.y - start.y) * progress) })
    }
    assert.equal(await page.locator('[data-series-placeholder]').count(), 1, 'a visible placeholder shows the drop position')
    if (!cancel) await page.screenshot({ path: resolve(output, 'admin-series-cards-mobile-touch-dragging.png') })
    if (cancel) await page.keyboard.press('Escape')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  } else {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 8, start.y, { steps: 3 })
    await page.mouse.move(end.x, end.y, { steps: 20 })
    assert.equal(await page.locator('[data-series-placeholder]').count(), 1, 'a visible placeholder shows the drop position')
    if (!cancel) await page.screenshot({ path: resolve(output, 'admin-series-cards-desktop-pointer-dragging.png') })
    if (cancel) await page.keyboard.press('Escape')
    await page.mouse.up()
  }
  await page.locator('[data-series-placeholder]').waitFor({ state: 'detached' })
}

async function publishOrder(page, expected) {
  await page.getByText('含未保存的修改', { exact: true }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('[role="button"], button')].some(element => element.className.includes('PublishButton') && element.textContent.trim() === '发布'))
  const publish = page.locator('[role="button"][class*="PublishButton"]').first()
  if (await publish.count()) await publish.click()
  else await page.getByRole('button', { name: '发布', exact: true }).first().click()
  const confirm = page.getByText(/^(立即发布|现在发布|Publish now)$/i)
  await confirm.waitFor({ state: 'visible', timeout: 10000 })
  await confirm.click()
  await page.waitForFunction(({ slug, expected }) => {
    const source = window.repoFiles.source._series[`${slug}.md`].content
    const ids = [...source.matchAll(/^\s*-\s*post:\s*['"]?([^'"\r\n]+)['"]?\s*$/gm)].map(match => match[1].trim())
    return JSON.stringify(ids) === JSON.stringify(expected)
  }, { slug: entry, expected }, { timeout: 10000 })
  assert.deepEqual(chapterIDs(await savedContent(page)), expected, 'Decap serializes card order into YAML')
}

try {
  for (const mobile of [false, true]) {
    const { context, page } = await createPage(mobile)
    const mode = mobile ? 'mobile-touch' : 'desktop-pointer'
    console.log(`${mode}: opening the disposable editor`)
    await openEditor(page)
    await inspectLayout(page, `admin-series-cards-${mode}`)
    const savedBeforeDrag = await savedContent(page)
    const swapped = [originalOrder[1], originalOrder[0], ...originalOrder.slice(2)]
    await dragFirstBelowSecond(page, mobile, true)
    await expectOrder(page, originalOrder)
    assert.equal(await savedContent(page), savedBeforeDrag, 'Escape cancels the drag without saving')
    await dragFirstBelowSecond(page, mobile)
    await expectOrder(page, swapped)
    assert.equal(await savedContent(page), savedBeforeDrag, 'dragging changes the unsaved editor, not repository data')
    await publishOrder(page, swapped)
    await inspectLayout(page, `admin-series-cards-${mode}-saved`)
    results.push({ scenario: mode, dragAndPublish: 'passed', escapeCancel: 'passed', savedFirstChapters: swapped.slice(0, 3) })
    console.log(`${mode}: drag, cancel, and publish passed`)

    // Focus actual controls and activate with keys, without invoking widget
    // internals or injecting React state.
    const firstCard = page.locator(cardSelector).first()
    assert.equal(await firstCard.locator('[data-series-move="up"]').isDisabled(), true)
    await firstCard.locator('[data-series-move="down"]').focus()
    await page.keyboard.press('Enter')
    await expectOrder(page, originalOrder)
    assert.deepEqual(chapterIDs(await savedContent(page)), swapped, 'keyboard changes stay unsaved until publishing')
    await publishOrder(page, originalOrder)
    await page.locator(cardSelector).nth(1).locator('[data-series-move="up"]').focus()
    await page.keyboard.press('Space')
    await expectOrder(page, swapped)
    assert.deepEqual(chapterIDs(await savedContent(page)), originalOrder)

    await page.reload({ waitUntil: 'networkidle' })
    await waitForEditor(page)
    await expectOrder(page, originalOrder)
    assert.deepEqual(chapterIDs(await savedContent(page)), originalOrder, 'reload discards edits and restores source order')
    assert.equal(await readFile(sourcePath, 'utf8'), originalSource, 'QA never modifies on-disk source')
    results.push({ scenario: `${mode}-keyboard-and-discard`, upAndDown: 'passed', reload: 'passed' })
    console.log(`${mode}: keyboard moves, publish, and reload passed`)

    await page.locator('[data-series-add-toggle]').click()
    const choices = page.locator('[data-series-add]')
    const availableIds = await choices.evaluateAll(buttons => buttons.map(button => button.dataset.postId))
    assert.ok(availableIds.length > 0, 'the current repository has standalone articles available to add')
    assert.ok(availableIds.every(id => !originalOrder.includes(id)), 'already selected chapters cannot be added twice')
    const addedId = availableIds[0]
    await choices.first().click()
    await expectOrder(page, [...originalOrder, addedId])
    assert.deepEqual(chapterIDs(await savedContent(page)), originalOrder, 'adding a card does not autosave')
    await page.locator(cardSelector).last().locator('[data-series-remove]').click()
    await expectOrder(page, originalOrder)
    assert.deepEqual(chapterIDs(await savedContent(page)), originalOrder, 'removing a card does not write an article or autosave')
    results.push({ scenario: `${mode}-add-remove`, duplicateChoices: 'excluded', unsavedAddAndRemove: 'passed' })
    // Decap retains its dirty marker even when add/remove returns to the same
    // value. Discard that edit explicitly before testing list navigation.
    await page.reload({ waitUntil: 'networkidle' })
    await waitForEditor(page)
    await expectOrder(page, originalOrder)

    await page.locator('a[href="#/collections/series"]').first().click()
    await page.locator('[data-admin-page="collection"][data-admin-collection="series"]').waitFor()
    const tabs = page.getByRole('navigation', { name: '内容类型', exact: true })
    await tabs.getByRole('link', { name: '文章', exact: true }).click()
    await page.locator('[data-admin-page="collection"][data-admin-collection="posts"]').waitFor()
    await tabs.getByRole('link', { name: '合集', exact: true }).click()
    await page.locator('[data-admin-page="collection"][data-admin-collection="series"]').waitFor()
    await page.getByRole('link', { name: '新建合集', exact: true }).waitFor()
    await page.screenshot({ path: resolve(output, `admin-series-list-${mobile ? 375 : 1440}.png`) })
    await context.close()
    activePage = undefined
  }
  assert.deepEqual(errors, [], 'no uncaught browser errors')
  assert.deepEqual(blockedWrites, [], 'the disposable backend attempted no network writes')
  assert.equal(await readFile(sourcePath, 'utf8'), originalSource)
  const report = { results, errors, blockedWrites, realRepositoryWrites: false, screenshots: output }
  await writeFile(resolve(output, 'admin-series-cards-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: resolve(output, 'admin-series-cards-failure.png') }).catch(() => {})
    console.error((await activePage.locator('body').innerText().catch(() => 'No document')).slice(0, 1000))
    console.error(JSON.stringify({ results, errors, blockedWrites, displayedOrder: await displayedOrder(activePage).catch(() => []) }))
  }
  throw error
} finally {
  await browser.close()
}
