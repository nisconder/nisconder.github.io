const PUBLIC_INDEX = /^\/(?:search|articles|series)\/?$/
const SERIES_DETAIL = /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/
const DATED_ARTICLE = /^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/

// A deliberately small allowlist: never fetch admin, external or arbitrary URLs.
export function publicNavigationKey(input, origin) {
  try {
    const url = new URL(input, origin)
    if (!/^https?:$/.test(url.protocol) || url.origin !== new URL(origin).origin || url.username || url.password) return null
    if (!PUBLIC_INDEX.test(url.pathname) && !SERIES_DETAIL.test(url.pathname) && !DATED_ARTICLE.test(url.pathname)) return null
    if (url.pathname.split('/').some((part) => /[\/\\\u0000-\u001f]/.test(decodeURIComponent(part)))) return null
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

export function canPrefetch(document, connection) {
  return document.visibilityState === 'visible' && !document.prerendering &&
    !connection?.saveData && !/2g/.test(connection?.effectiveType ?? '')
}

export function parseNavigationHtml(html, Parser = DOMParser) {
  const document = new Parser().parseFromString(html, 'text/html')
  if (!document.querySelector('meta[name="astro-view-transitions-enabled"]')) return null
  // Keep Astro's stylesheet preload behavior if a future page stops inlining CSS.
  if (document.head.querySelector('link[rel~="stylesheet"]')) return null
  // Astro's default loader removes these before its normal swap/script lifecycle.
  document.querySelectorAll('noscript').forEach((node) => node.remove())
  return document
}

export function createNavigationCache({
  origin, fetch: fetchHtml = globalThis.fetch, parse = parseNavigationHtml,
  now = Date.now, maxEntries = 3, ttl = 60_000,
} = {}) {
  const entries = new Map()

  const discard = (key, entry) => {
    if (entries.get(key) === entry) entries.delete(key)
    entry.controller.abort()
  }
  const prune = () => {
    for (const [key, entry] of entries) {
      if (now() - entry.created >= ttl) discard(key, entry)
    }
  }

  const prefetch = (input) => {
    const key = publicNavigationKey(input, origin)
    if (!key) return Promise.resolve(null)
    prune()
    if (entries.has(key)) return entries.get(key).promise
    while (entries.size >= maxEntries) {
      const [oldestKey, oldest] = entries.entries().next().value
      discard(oldestKey, oldest)
    }
    const entry = { created: now(), controller: new AbortController(), promise: null }
    entries.set(key, entry)
    entry.promise = (async () => {
      try {
        const response = await fetchHtml(key, {
          signal: entry.controller.signal, credentials: 'same-origin',
          redirect: 'manual', priority: 'low', headers: { Accept: 'text/html' },
        })
        const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
        if (response.status !== 200 || response.redirected || type !== 'text/html' ||
            !response.url || publicNavigationKey(response.url, origin) !== key) return null
        const html = await response.text()
        if (entry.controller.signal.aborted || now() - entry.created >= ttl) return null
        return parse(html)
      } catch {
        return null
      }
    })().then((document) => {
      if (!document && entries.get(key) === entry) entries.delete(key)
      return document
    })
    return entry.promise
  }

  // Take ownership once, even while in flight. Astro will mutate this document.
  const consume = async (input, signal) => {
    prune()
    const key = publicNavigationKey(input, origin)
    const entry = entries.get(key)
    if (!entry) return null
    entries.delete(key)
    if (signal?.aborted) {
      entry.controller.abort()
      return null
    }
    let abort
    const cancelled = new Promise((resolve) => {
      abort = () => { entry.controller.abort(); resolve(null) }
      signal?.addEventListener('abort', abort, { once: true })
    })
    try {
      return await Promise.race([entry.promise, cancelled])
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  return { prefetch, consume, clear() {
    for (const [key, entry] of entries) discard(key, entry)
  } }
}

export function installCachedNavigationLoader(document, cache) {
  const prepare = (event) => {
    if (event.formData || event.defaultPrevented) return
    const originalLoader = event.loader
    event.loader = async () => {
      if (event.signal.aborted) return
      let nextDocument
      try { nextDocument = await cache.consume(event.to.href, event.signal) } catch { /* use Astro's loader */ }
      if (event.signal.aborted) return
      if (nextDocument) event.newDocument = nextDocument
      else return originalLoader.call(event)
    }
  }
  document.addEventListener('astro:before-preparation', prepare)
  return () => document.removeEventListener('astro:before-preparation', prepare)
}

export function installPublicNavigationPrefetch(document, window) {
  const cache = createNavigationCache({ origin: window.location.origin })
  const removeLoader = installCachedNavigationLoader(document, cache)
  const controller = new AbortController()
  const { signal } = controller
  let observer
  let idle
  const automaticTargets = new Set()
  const permitted = () => canPrefetch(document, window.navigator.connection)
  const prefetch = (href) => {
    if (permitted() && publicNavigationKey(href, window.location.origin) !==
        publicNavigationKey(window.location.href, window.location.origin)) void cache.prefetch(href)
  }
  const intent = (event) => {
    const link = event.target?.closest?.('a[data-astro-prefetch]')
    if (!link || link.dataset.astroPrefetch === 'false' || link.hasAttribute('download') ||
        link.hasAttribute('data-astro-reload') || (link.target && link.target !== '_self')) return
    if (event.type === 'pointerover' && link.contains(event.relatedTarget)) return
    prefetch(link.href)
  }
  const cancelAutomatic = () => {
    observer?.disconnect()
    observer = undefined
    if (window.cancelIdleCallback) window.cancelIdleCallback(idle)
    else window.clearTimeout(idle)
    idle = undefined
  }
  const scheduleHomeArticle = () => {
    cancelAutomatic()
    if (window.location.pathname !== '/' || !permitted()) return
    const link = document.querySelector('.home-articles .article-panel__body h2 a')
    if (!link || automaticTargets.has(link.href) || !window.IntersectionObserver) return
    const href = link.href
    observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer?.disconnect()
      const run = () => {
        idle = undefined
        if (!link.isConnected || !permitted() || window.location.pathname !== '/') return
        automaticTargets.add(href)
        prefetch(href)
      }
      idle = window.requestIdleCallback ? window.requestIdleCallback(run) : window.setTimeout(run, 200)
    })
    observer.observe(link)
  }
  document.addEventListener('pointerover', intent, { passive: true, signal })
  document.addEventListener('focusin', intent, { signal })
  document.addEventListener('touchstart', intent, { passive: true, signal })
  document.addEventListener('astro:before-preparation', cancelAutomatic, { signal })
  document.addEventListener('astro:page-load', scheduleHomeArticle, { signal })
  document.addEventListener('visibilitychange', scheduleHomeArticle, { signal })
  document.addEventListener('prerenderingchange', scheduleHomeArticle, { signal })
  // Initial load waits for a usable first screen. Subsequent pages use Astro's event.
  if (document.readyState === 'complete') scheduleHomeArticle()
  else window.addEventListener('load', scheduleHomeArticle, { once: true, signal })
  return () => { controller.abort(); cancelAutomatic(); removeLoader(); cache.clear() }
}
