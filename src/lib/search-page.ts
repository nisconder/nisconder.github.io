import { normaliseSearch, readSearchState, searchTerms, type SearchState, type SearchRecord } from './search-core.mjs'
import { createSearchSession, getCompactIndex } from './search-client.mjs'

type SearchView = {
  state: SearchState
  matches: { item: SearchRecord; score: number }[]
  total: number
  foldable?: number
  pending: boolean
  error: boolean
}

const tagLimit = 5
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }) : null

function highlight(element: HTMLElement, value: string, terms: string[]) {
  if (!terms.length) { element.textContent = value; return }
  const normalized = normaliseSearch(value)
  const matched = new Uint8Array(normalized.length)
  for (const term of terms) {
    for (let i = normalized.indexOf(term); i !== -1; i = normalized.indexOf(term, i + 1)) {
      matched.fill(1, i, i + term.length)
    }
  }
  if (!matched.includes(1)) { element.textContent = value; return }

  // Keep the author's original characters when a full-width or combined glyph matches.
  let offset = 0
  let mark: HTMLElement | null = null
  const parts = graphemes?.segment(value) ?? Array.from(value, segment => ({ segment }))
  for (const { segment } of parts) {
    const end = offset + normaliseSearch(segment).length
    if (matched.subarray(offset, end).includes(1)) {
      if (!mark) { mark = document.createElement('mark'); element.append(mark) }
      mark.append(segment)
    } else { mark = null; element.append(segment) }
    offset = end
  }
  element.normalize()
}

export function initialiseSearch() {
  const form = document.querySelector<HTMLFormElement>('[data-search-form]')
  if (!form || form.dataset.searchBound === 'true') return
  const input = form.querySelector<HTMLInputElement>('[data-search-input]')
  const status = document.querySelector<HTMLElement>('[data-search-status]')
  const results = document.querySelector<HTMLElement>('[data-search-results]')
  const payloadElement = document.querySelector<HTMLScriptElement>('[data-search-catalog]')
  if (!input || !status || !results || !payloadElement) return
  const payload = JSON.parse(payloadElement.textContent ?? '{}')
  const compact = getCompactIndex(payload.fullUrl, payload.items)
  const lifecycle = new AbortController()
  const { signal } = lifecycle
  const pagePath = window.location.pathname
  const isActive = () => !signal.aborted && form.isConnected
  const categoryButtons = Array.from(form.querySelectorAll<HTMLButtonElement>('[data-category]'))
  const typeButtons = form.querySelectorAll<HTMLButtonElement>('[data-search-type]')
  const categories = form.querySelector<HTMLElement>('[data-category-filter]')
  const foldControl = document.querySelector<HTMLElement>('[data-fold-control]')
  const fold = document.querySelector<HTMLInputElement>('[data-fold-chapters]')
  let activeCategory = ''
  let activeType = ''
  let composing = false
  let frame = 0
  let renderedKey = ''
  form.dataset.searchBound = 'true'

  const textElement = (tag: string, text: string, className?: string) => {
    const element = document.createElement(tag)
    element.textContent = text
    if (className) element.className = className
    return element
  }
  const linkElement = (href: string, text: string, className?: string) => {
    const element = textElement('a', text, className) as HTMLAnchorElement
    element.href = href
    return element
  }

  const render = ({ state, matches, total, foldable = 0, pending, error }: SearchView) => {
    if (!isActive()) return
    const { query, category, type } = state
    const folded = state.collapseChapters ? foldable : 0
    if (foldControl) foldControl.hidden = Boolean(type) || !(foldable || state.collapseChapters)
    const hasSearch = Boolean(query || category || type)
    const scopeNames: Record<string, string> = { article: '文章', project: '项目', series: '合集' }
    const scope = category ? `“${category}”分类` : (scopeNames[type] ?? '全站')
    status.setAttribute('aria-busy', String(pending))
    status.dataset.searchPhase = pending ? 'partial' : error ? 'error' : 'complete'
    if (!hasSearch) status.textContent = '输入关键词，或按内容类型和文章分类浏览。'
    else if (pending) status.textContent = total ? `已在${scope}找到 ${total} 条，正在继续检索正文…` : '正在检索正文…'
    else if (error) {
      status.textContent = `${total ? `已在${scope}找到 ${total} 条。` : '标题、摘要和标签中暂未找到匹配。'}正文暂时无法载入。 `
      const retry = textElement('button', '重试正文搜索', 'search-retry') as HTMLButtonElement
      retry.type = 'button'
      retry.dataset.searchRetry = ''
      retry.addEventListener('click', executeCurrent, { signal })
      status.append(retry)
    } else status.textContent = total
      ? `在${scope}中找到 ${total} 条${query ? `与“${query}”匹配的内容` : '内容'}。${folded ? `已折叠 ${folded} 篇合集章节。` : ''}${total - folded > matches.length ? `先显示前 ${matches.length} 条。` : ''}`
      : `在${scope}中没有找到${query ? `与“${query}”匹配的内容` : '公开内容'}。可以减少关键词或切换分类。`

    // Full text often confirms the same metadata matches. Keep those DOM nodes
    // and their focus intact instead of painting the same list a second time.
    const empty = hasSearch && !total && !pending && !error
    const key = JSON.stringify([query, matches.map(({ item }) => item.href), empty])
    if (key === renderedKey) return
    renderedKey = key
    const fragment = document.createDocumentFragment()
    const terms = searchTerms(query)
    for (const [index, { item }] of matches.entries()) {
      const article = document.createElement('article')
      article.className = 'search-result'
      const meta = textElement('p', '', 'search-result__meta')
      if (item.kind) meta.append(item.kind)
      if (item.kind && (item.category || item.date)) meta.append(' · ')
      if (item.category) meta.append(item.kind === '文章'
        ? linkElement(`/search/?category=${encodeURIComponent(item.category)}`, item.category)
        : item.category)
      if (item.category && item.date) meta.append(' · ')
      if (item.date) meta.append(item.date)
      const heading = document.createElement('h2')
      const title = linkElement(item.href, '')
      highlight(title, item.title || '未命名内容', terms)
      heading.append(title)
      article.append(meta, heading)
      if (item.description) {
        const description = textElement('p', '', 'search-result__description')
        highlight(description, item.description, terms)
        article.append(description)
      }
      if (item.tags.length) {
        const tags = document.createElement('nav')
        tags.className = 'search-result__tags'
        tags.setAttribute('aria-label', `《${item.title || '未命名内容'}》的标签`)
        const ranked = item.tags.map(tag => {
          const name = normaliseSearch(tag)
          const score = terms.reduce((sum, term) => sum + (name === term ? 2 : Number(name.includes(term))), 0)
          return { tag, score }
        }).sort((a, b) => b.score - a.score)
        const tagLink = ({ tag }: { tag: string }) => linkElement(`/search/?q=${encodeURIComponent(tag)}`, `#${tag}`)
        tags.append(...ranked.slice(0, tagLimit).map(tagLink))
        if (ranked.length > tagLimit) {
          const count = ranked.length - tagLimit
          const more = textElement('button', `+${count}`, 'search-result__more') as HTMLButtonElement
          const extra = textElement('span', '', 'search-result__extra')
          extra.id = `extra-tags-${index}`
          extra.hidden = true
          more.type = 'button'
          more.setAttribute('aria-controls', extra.id)
          more.setAttribute('aria-expanded', 'false')
          more.setAttribute('aria-label', `展开其余 ${count} 个标签`)
          more.addEventListener('click', () => {
            if (!extra.childElementCount) extra.append(...ranked.slice(tagLimit).map(tagLink))
            extra.hidden = !extra.hidden
            more.setAttribute('aria-expanded', String(!extra.hidden))
            more.textContent = extra.hidden ? `+${count}` : '收起标签'
            more.setAttribute('aria-label', extra.hidden ? `展开其余 ${count} 个标签` : '收起标签')
          })
          tags.append(more, extra)
        }
        article.append(tags)
      }
      fragment.append(article)
    }
    if (empty) fragment.append(linkElement('/articles/', '浏览全部文章 →', 'search-empty-link'))
    results.replaceChildren(fragment)
  }

  const session = createSearchSession({ compact, fullUrl: payload.fullUrl, onResults: render })
  const updateFilters = () => {
    for (const button of typeButtons) button.setAttribute('aria-pressed', String(button.dataset.searchType === activeType))
    if (categories) categories.hidden = Boolean(activeType && activeType !== 'article')
    for (const button of categoryButtons) {
      const category = button.dataset.category ?? ''
      button.setAttribute('aria-pressed', String(category ? category === activeCategory : activeType === 'article' && !activeCategory))
    }
  }
  const syncUrl = (state: SearchState) => {
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries({ q: state.query, category: state.category, type: state.category ? '' : state.type, chapters: state.collapseChapters ? 'fold' : '' })) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  function executeCurrent() {
    cancelAnimationFrame(frame)
    frame = 0
    if (!isActive() || composing) return
    const state = { query: input!.value.trim(), category: activeCategory, type: activeType, collapseChapters: !activeType && Boolean(fold?.checked) }
    syncUrl(state)
    void session.run(state)
  }
  const applyUrlState = () => {
    if (!isActive() || window.location.pathname !== pagePath) return
    cancelAnimationFrame(frame)
    frame = 0
    composing = false
    const state = readSearchState(new URLSearchParams(window.location.search))
    activeCategory = state.category
    activeType = state.type
    if (fold) fold.checked = Boolean(state.collapseChapters)
    input.value = state.query
    updateFilters()
    void session.run(state)
  }

  fold?.addEventListener('change', executeCurrent, { signal })
  input.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || composing || event.isComposing) return
    event.preventDefault()
    if (!input.value) { input.blur(); return }
    input.value = ''
    executeCurrent()
  }, { signal })
  input.addEventListener('compositionstart', () => {
    composing = true
    cancelAnimationFrame(frame)
    session.invalidate()
  }, { signal })
  input.addEventListener('compositionend', () => {
    composing = false
    executeCurrent()
  }, { signal })
  input.addEventListener('input', event => {
    if (composing || (event as InputEvent).isComposing) return
    session.invalidate()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(executeCurrent)
  }, { signal })
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (!composing) executeCurrent()
  }, { signal })
  for (const button of categoryButtons) button.addEventListener('click', () => {
    activeCategory = button.dataset.category ?? ''
    activeType = 'article'
    updateFilters()
    executeCurrent()
  }, { signal })
  for (const button of typeButtons) button.addEventListener('click', () => {
    activeType = button.dataset.searchType ?? ''
    if (activeType !== 'article') activeCategory = ''
    updateFilters()
    executeCurrent()
  }, { signal })
  window.addEventListener('popstate', applyUrlState, { signal })
  document.addEventListener('astro:before-swap', () => {
    lifecycle.abort()
    session.dispose()
    cancelAnimationFrame(frame)
    delete form.dataset.searchBound
  }, { once: true, signal })
  applyUrlState()
}
