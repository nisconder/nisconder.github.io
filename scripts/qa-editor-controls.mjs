// Run against scripts/preview-admin.mjs with --url and a Playwright --modules directory.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const require = createRequire(resolve(option('--modules', './node_modules'), 'package.json'))
const { chromium } = require('playwright')
const base = new URL(option('--url', 'http://127.0.0.1:4342/'))
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname))
const config = await fetch(new URL('/admin/config.yml', base)).then(response => response.text())
assert.match(config, /^\s+name: test-repo\s*$/m)
const { posts } = await fetch(new URL('/admin/post-options.json', base)).then(response => response.json())
const entry = option('--entry', posts[0].id)
const screenshots = option('--screenshots')
if (screenshots) await mkdir(screenshots, { recursive: true })

const header = '[data-admin-shell="editor-toolbar"]'
const views = '[data-admin-section="editor-view-controls"]'
const formatting = '[data-admin-section="editor-toolbar"]'
const topButtons = header + ' :is(a[href],button,[role="button"]), ' + views + ' button'
const previewButton = '[data-admin-action="preview-toggle"]'
const widths = [320, 360, 375, 390, 420, 421, 480, 600, 768, 895, 896, 897, 1024, 1366, 1440]
const browser = await chromium.launch({ channel: 'chrome' })

// A rectangle can fit in the viewport while another layer intercepts half of it.
async function checkTargets(page, selector, scenario, scroll = false) {
  const { errors, names } = await page.locator(selector).evaluateAll((elements, scrolled) => {
    const errors = []
    const seen = []
    const describe = element => element.getAttribute('aria-label') || element.title || element.textContent.trim()
    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height || getComputedStyle(el).visibility !== 'visible') continue
      if (scrolled && rect.bottom <= 0) continue
      const name = describe(el)
      if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) {
        errors.push(name + ' outside viewport ' + JSON.stringify(rect.toJSON()))
      }
      for (const other of seen) {
        const sharedWidth = Math.min(rect.right, other.rect.right) - Math.max(rect.left, other.rect.left)
        const sharedHeight = Math.min(rect.bottom, other.rect.bottom) - Math.max(rect.top, other.rect.top)
        if (sharedWidth > 1 && sharedHeight > 1) errors.push(name + ' overlaps ' + other.name)
      }
      seen.push({ name, rect })
      if (el.matches(':disabled,[aria-disabled="true"]')) continue
      const dx = Math.min(8, rect.width / 4)
      const dy = Math.min(8, rect.height / 4)
      const points = [[rect.width / 2, rect.height / 2], [dx, dy], [rect.width - dx, dy],
        [dx, rect.height - dy], [rect.width - dx, rect.height - dy]]
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(rect.left + x, rect.top + y)
        if (!el.contains(hit)) {
          const path = hit && [hit, hit.parentElement, hit.parentElement?.parentElement]
            .filter(Boolean).map(node => node.tagName + '.' + node.className).join(' in ')
          errors.push(name + ' at ' + [rect.left + x, rect.top + y].map(Math.round) + ' intercepted by ' + (path || 'viewport'))
          break
        }
      }
    }
    if (document.documentElement.scrollWidth > innerWidth + 1) errors.push('horizontal overflow')
    return { errors, names: seen.map(item => item.name) }
  }, scroll)
  assert.deepEqual(errors, [], scenario)
  return names
}

async function atTop(page) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function openEditor(page, route) {
  await page.goto(new URL('/admin/content/#/collections/posts/' + route, base).href)
  const login = page.getByRole('button', { name: /登录|login/i })
  await login.or(page.locator('[data-admin-form="post"]')).first().waitFor()
  if (await login.isVisible()) await login.click()
  await page.locator('[data-admin-form="post"]').waitFor()
  await page.locator(previewButton).waitFor()
  await page.evaluate(() => document.fonts.ready)
}

async function checkMenu(page, trigger, scenario) {
  const menu = page.locator(header + ' [role="menu"]')
  await trigger.click()
  await menu.waitFor()
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true', scenario)
  assert.ok((await checkTargets(page, header + ' [role="menuitem"]', scenario)).length, scenario)
  await trigger.click()
  await menu.waitFor({ state: 'hidden' })
}

async function checkPage(page, published, width) {
  const name = (published ? 'published ' : 'new ') + width
  await page.setViewportSize({ width, height: width === 600 ? 390 : 840 })
  await atTop(page)
  const names = await checkTargets(page, topButtons, name)
  assert.ok(names.includes('返回文章列表') && names.includes('预览文章'), name)
  assert.ok(names.some(label => /account/i.test(label)), name)
  if (published) {
    assert.ok(names.some(label => /删除/.test(label)) && names.includes('查看发布'), name)
    await page.getByRole('button', { name: /删除/ }).click({ trial: true })
    await page.getByRole('link', { name: '查看发布' }).click({ trial: true })
  }
  await checkMenu(page, page.locator(header + ' [aria-label*="Account"]'), name + ' account')
  await checkMenu(page, page.locator('[data-admin-action="publish"]'), name + ' publish')
  if (published && screenshots && [390, 1366].includes(width)) {
    await page.screenshot({ path: resolve(screenshots, 'nisconder-editor-toolbar-' + width + '.png') })
  }
  const toggle = page.locator(previewButton)
  await toggle.click()
  await page.locator('#nc-root[data-admin-preview="open"] iframe#preview-pane').waitFor()
  await checkTargets(page, topButtons, name + ' preview')
  await toggle.focus()
  await page.keyboard.press('Enter')
  await page.locator('#nc-root[data-admin-preview="closed"] [data-admin-form="post"]').waitFor()
  if (published) {
    const body = page.locator('[data-admin-field="body"]')
    await body.locator('textarea:visible,[contenteditable="true"]:visible').first().focus()
    await body.evaluate(el => window.scrollTo({ top: scrollY + el.getBoundingClientRect().top + 180, behavior: 'instant' }))
    await page.waitForFunction(bar => {
      const panel = document.querySelector(bar).getBoundingClientRect()
      const actions = document.querySelector('[data-admin-section="editor-view-controls"]').getBoundingClientRect()
      return panel.bottom > 0 && Math.abs(panel.top - actions.bottom) <= 1
    }, formatting, { timeout: 3000 })
    const pinned = await checkTargets(page, topButtons + ', ' + formatting + ' button', name + ' scrolled', true)
    assert.ok(pinned.includes('标题') && pinned.includes('预览文章'), name + ' scrolled')
    if (screenshots && width === 390) {
      await page.screenshot({ path: resolve(screenshots, 'nisconder-editor-toolbar-scrolled-390.png') })
    }
  }
}

async function checkCollection(page) {
  await page.getByRole('link', { name: '返回文章列表' }).click()
  await page.locator('[data-admin-section="list-toolbar"]').waitFor()
  const controls = '[data-admin-shell="header"] :is(a,button,[role="button"]), ' +
    '[data-admin-action="new-post"], [data-admin-section="list-toolbar"] :is(button,[role="button"])'
  for (const width of [320, 390, 768, 1366]) {
    await page.setViewportSize({ width, height: 840 })
    await atTop(page)
    const names = await checkTargets(page, controls, 'collection ' + width)
    assert.ok(names.includes('返回管理首页') && names.includes('新建文章'))
  }
  console.log('Collection navigation: checked 320, 390, 768, 1366 px')
}

try {
  for (const published of [true, false]) {
    const context = await browser.newContext({ locale: 'zh-CN', reducedMotion: 'reduce', colorScheme: published ? 'dark' : 'light' })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      await openEditor(page, published ? 'entries/' + encodeURIComponent(entry) : 'new')
      if (!published) await page.locator('[data-admin-field="title"] input').fill('本地工具栏测试')
      for (const width of widths) await checkPage(page, published, width)
      if (published) await checkCollection(page)
      console.log((published ? 'Published article' : 'Unsaved article') + ': checked ' + widths.join(', ') + ' px')
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
