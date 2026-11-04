import { readSearchState, type SearchState, type SearchRecord } from './search-core.mjs'
import { createSearchSession, getCompactIndex } from './search-client.mjs'

type SearchView = {
  state: SearchState
  matches: { item: SearchRecord; score: number }[]
  total: number
  pending: boolean
  error: boolean
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

  const render = ({ state, matches, total, pending, error }: SearchView) => {
    if (!isActive()) return
    const { query, category, type } = state
    const hasSearch = Boolean(query || category || type)
    const scopeNames: Record<string, string> = { article: '文章', project: '项目', series: '合集' }
    const scope = category ? `“${category}”分类` : (scopeNames[type] ?? '全站')
    status.setAttribute('aria-busy', String(pending))
    status.dataset.searchPhase = pending ? 'partial' : error ? 'error' : 'complete'
    if (!hasSearch) status.textContent = '输入关键词，或选择一个文章分类。'
    else if (pending) status.textContent = total ? `已在${scope}找到 ${total} 条，正在继续检索正文…` : '正在检索正文…'
    else if (error) {
      status.textContent = `${total ? `已在${scope}找到 ${total} 条。` : '标题、摘要和标签中暂未找到匹配。'}正文暂时无法载入。 `
      const retry = textElement('button', '重试正文搜索', 'search-retry') as HTMLButtonElement
      retry.type = 'button'
      retry.dataset.searchRetry = ''
      retry.addEventListener('click', executeCurrent, { signal })
      status.append(retry)
    } else status.textContent = total
      ? `在${scope}中找到 ${total} 条${query ? `与“${query}”匹配的内容` : '内容'}。${total > matches.length ? `先显示前 ${matches.length} 条。` : ''}`
      : `在${scope}中没有找到${query ? `与“${query}”匹配的内容` : '公开内容'}。可以减少关键词或切换分类。`

    // Full text often confirms the same metadata matches. Keep those DOM nodes
    // and their focus intact instead of painting the same list a second time.
    const empty = hasSearch && !total && !pending && !error
    const key = JSON.stringify([matches.map(({ item }) => item.href), empty])
    if (key === renderedKey) return
    renderedKey = key
    const fragment = document.createDocumentFragment()
    for (const { item } of matches) {
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
      heading.append(linkElement(item.href, item.title || '未命名内容'))
      article.append(meta, heading)
      if (item.description) article.append(textElement('p', item.description, 'search-result__description'))
      if (item.tags.length) {
        const tags = document.createElement('nav')
        tags.className = 'search-result__tags'
        tags.setAttribute('aria-label', `《${item.title || '未命名内容'}》的标签`)
        for (const tag of item.tags) tags.append(linkElement(`/search/?q=${encodeURIComponent(tag)}`, `#${tag}`))
        article.append(tags)
      }
      fragment.append(article)
    }
    if (empty) fragment.append(linkElement('/articles/', '浏览全部文章 →', 'search-empty-link'))
    results.replaceChildren(fragment)
  }

  const session = createSearchSession({ compact, fullUrl: payload.fullUrl, onResults: render })
  const updateCategoryButtons = () => {
    for (const button of categoryButtons) {
      const category = button.dataset.category ?? ''
      button.setAttribute('aria-pressed', String(category ? category === activeCategory : activeType === 'article' && !activeCategory))
    }
  }
  const syncUrl = (state: SearchState) => {
    const url = new URL(window.location.href)
    for (const [key, value] of Object.entries({ q: state.query, category: state.category, type: state.category ? '' : state.type })) {
      if (value) url.searchParams.set(key, value)
      else url.searchParams.delete(key)
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
  function executeCurrent() {
    cancelAnimationFrame(frame)
    frame = 0
    if (!isActive() || composing) return
    const state = { query: input!.value.trim(), category: activeCategory, type: activeType }
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
    input.value = state.query
    updateCategoryButtons()
    void session.run(state)
  }

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
    updateCategoryButtons()
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
