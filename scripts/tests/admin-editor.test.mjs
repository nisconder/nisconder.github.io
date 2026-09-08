import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { Element, Text } from 'domhandler'
import { selectAll, is } from 'css-select'
import { textContent } from 'domutils'
import postcss from 'postcss'

const script = readFileSync(new URL('../../source/admin/admin-ui.js', import.meta.url), 'utf8')
const css = postcss.parse(readFileSync(new URL('../../source/admin/admin-theme.css', import.meta.url), 'utf8'))

// DOM contract fixture based on the pinned Decap 3.15.1 EditorControl,
// DateTimeControl and Markdown Toolbar. No authenticated CMS data is used.
function fixture() {
  const wrappers = new WeakMap()
  const wrap = (node) => {
    if (!node) return null
    if (!wrappers.has(node)) wrappers.set(node, new DOMElement(node))
    return wrappers.get(node)
  }
  class DOMElement {
    constructor(node) { this.node = node }
    get tagName() { return this.node.name.toUpperCase() }
    get id() { return this.getAttribute('id') || '' }
    get className() { return this.getAttribute('class') || '' }
    get textContent() { return textContent(this.node) }
    get parentElement() { return wrap(this.node.parent) }
    get children() { return this.node.children.filter((node) => node.type === 'tag').map(wrap) }
    get firstElementChild() { return this.children[0] || null }
    get lastElementChild() { return this.children.at(-1) || null }
    get dataset() {
      const attribute = (key) => `data-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`
      return new Proxy({}, {
        get: (_, key) => this.getAttribute(attribute(key)) ?? undefined,
        set: (_, key, value) => { this.setAttribute(attribute(key), value); return true },
        deleteProperty: (_, key) => { delete this.node.attribs[attribute(key)]; return true },
      })
    }
    getAttribute(key) { return this.node.attribs[key] ?? null }
    setAttribute(key, value) { this.node.attribs[key] = String(value) }
    querySelectorAll(selector) { return selectAll(selector, this.node.children).map(wrap) }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
    closest(selector) {
      let current = this
      while (current) {
        if (is(current.node, selector)) return current
        current = current.parentElement
      }
      return null
    }
    contains(other) {
      while (other) {
        if (other === this) return true
        other = other.parentElement
      }
      return false
    }
  }
  const element = (name, attributes = {}, ...children) => {
    const node = new Element(name, attributes, children.flat().map((child) => typeof child === 'string' ? new Text(child) : child))
    node.children.forEach((child, index) => {
      child.parent = node
      child.prev = node.children[index - 1] || null
      child.next = node.children[index + 1] || null
    })
    return node
  }
  const e = element
  const field = (name, label, control) => e('div', { class: 'css-ControlContainer', 'aria-label': label },
    e('div', { class: 'css-ControlTopbar' }, e('label', { for: `${name}-field-1` }, label)),
    control || e('input', { id: `${name}-field-1` }), e('p', { class: 'css-ControlHint' }, '字段说明'))
  const headingDropdown = e('div', { class: 'css-ToolbarDropdownWrapper' },
    e('div', { class: 'css-StyledWrapper' }, e('div', {},
      e('span', { role: 'button', 'aria-haspopup': 'true' }, e('button', { title: '标题' }, 'H')))),
    e('ul', { role: 'menu' }, e('li', { role: 'menuitem' }, '标题一')))
  const markdownToolbar = e('div', { class: 'css-ToolbarContainer' }, e('div', {},
    e('button', { title: '加粗' }, 'B'), e('button', { title: '斜体' }, 'I'), headingDropdown))
  const dateControl = e('div', {},
    e('input', { id: 'date-field-1', type: 'datetime-local' }),
    e('div', { style: 'display:flex;gap:20px;width:fit-content' },
      e('button', { 'data-testid': 'now-button', 'aria-label': '设为当前日期和时间' }, '现在'),
      e('button', { 'data-testid': 'clear-button', 'aria-label': '清空日期和时间' }, '清除')))
  const form = e('div', {},
    field('title', '标题'),
    field('description', '摘要', e('textarea', { id: 'description-field-1' })),
    field('date', '文章日期', dateControl),
    field('draft', '作为草稿', e('div', { id: 'draft-field-1' }, e('label', { class: 'admin-pin-control__option' }, e('input', { type: 'checkbox' }), '公开发布'))),
    field('sticky', '首页位置'), field('categories', '分类'), field('tags', '标签'),
    field('body', '正文', e('div', { id: 'body-field-1' }, markdownToolbar, e('textarea', { 'aria-label': 'Markdown' }))))
  const rootNode = e('div', { id: 'nc-root' }, e('div', {},
    e('div', {}, e('a', { href: '#/collections/posts' }, '返回'), e('button', {}, '已发布')),
    e('div', {}, e('div', {}, form))))
  const body = wrap(e('body', {}, rootNode))
  const document = {
    body,
    getElementById: (id) => body.querySelector(`[id="${id}"]`),
    querySelector: (selector) => body.querySelector(selector),
  }
  const window = { setTimeout() {}, requestAnimationFrame() {}, addEventListener() {} }
  const context = { window, document, MutationObserver: class { observe() {} } }
  vm.runInNewContext(script.replace('var observer = new MutationObserver', 'window.testDecorate = decorate; var observer = new MutationObserver'), context)
  window.location = { hash: '#/collections/posts/entries/example' }
  const decorate = () => window.testDecorate()
  decorate()
  return { root: wrap(rootNode), form: wrap(form), toolbar: wrap(markdownToolbar), heading: wrap(headingDropdown), date: wrap(dateControl), decorate }
}

test('fields have stable labels, hints and grid slots even with nested custom checkbox labels', () => {
  const f = fixture()
  assert.equal(f.form.dataset.adminForm, 'post')
  const fields = f.root.querySelectorAll('[data-admin-field]')
  assert.equal(fields.length, 8)
  for (const field of fields) {
    assert.equal(field.dataset.adminFieldSlot, field.dataset.adminField)
    assert.equal(field.querySelectorAll('[data-admin-field-label]').length, 1)
    assert.equal(field.querySelectorAll('[data-admin-field-hint]').length, 1)
  }
  assert.equal(f.root.querySelector('.admin-pin-control__option').dataset.adminFieldLabel, undefined)
})

test('the H dropdown is never classified as the entire toolbar', () => {
  const f = fixture()
  assert.equal(f.toolbar.dataset.adminSection, 'editor-toolbar')
  assert.equal(f.heading.dataset.adminSection, undefined)
  assert.equal(f.toolbar.firstElementChild.dataset.adminToolbarGroup, 'true')
  // Correct an old marker on a reused node, including a repeated decoration.
  f.heading.dataset.adminSection = 'editor-toolbar'
  f.decorate()
  assert.equal(f.heading.dataset.adminSection, undefined)
  assert.equal(f.root.querySelectorAll('[data-admin-section="editor-toolbar"]').length, 1)
})

test('date shortcuts use stable test ids regardless of their longer accessible names', () => {
  const f = fixture()
  assert.equal(f.date.dataset.adminDateRow, 'true')
  assert.equal(f.date.querySelector('input').dataset.adminDateInput, 'true')
  assert.equal(f.date.lastElementChild.dataset.adminDateActions, 'true')
  assert.equal(f.date.querySelector('[data-testid="now-button"]').dataset.adminAction, 'set-current-date')
  assert.equal(f.date.querySelector('[data-testid="clear-button"]').dataset.adminAction, 'clear-date')
})

function declarations(selector) {
  const result = {}
  css.walkRules((rule) => {
    if (rule.parent.type !== 'root' || !rule.selectors.includes(selector)) return
    rule.walkDecls((decl) => { result[decl.prop] = decl.value })
  })
  return result
}
const editor = '#nc-root[data-admin-page="editor"] '
test('field spacing is not erased by a second reset on the same element', () => {
  assert.equal(declarations(editor + '[data-admin-form="post"]').gap, '24px')
  assert.deepEqual(declarations(editor + '[data-admin-field]'), {})
  assert.equal(declarations(editor + '[data-admin-field]:not([data-admin-field-slot])').padding, '0')
})

test('menus remain unclipped and date controls remain visible without wrapping', () => {
  const toolbar = declarations(editor + '[data-admin-section="editor-toolbar"]')
  assert.equal(toolbar.overflow, 'visible')
  assert.equal(toolbar['flex-wrap'], 'wrap')
  assert.equal(toolbar['overflow-y'], undefined)
  const now = declarations(editor + '[data-admin-action="set-current-date"]')
  assert.notEqual(now.display, 'none')
  assert.equal(now['white-space'], 'nowrap')
  assert.equal(now.flex, '0 0 auto')
})

test('large editor sizing does not resize CodeMirror\'s hidden keyboard textarea', () => {
  assert.deepEqual(declarations(editor + '[data-admin-field="body"] textarea'), {})
  assert.ok(declarations(editor + '[data-admin-field="body"] textarea:not(.CodeMirror textarea)')['min-height'])
})
