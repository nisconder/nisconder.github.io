import { bindWalineLoginFeedback } from './waline-login-feedback.mjs'

const installedDocuments = new WeakSet()

// Binding is idempotent across Astro re-entry and leaves native BFCache intact.
// Prerendered documents must not initialize Waline or contact its services.
export function installCommentsController() {
  if (installedDocuments.has(document)) return
  installedDocuments.add(document)
  const initialize = () => {
    if (!document.prerendering) bindComments()
  }
  document.addEventListener('astro:page-load', initialize)
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', initialize, { once: true })
  } else {
    initialize()
  }
}

function bindComments() {
  const sections = [...document.querySelectorAll('[data-site-comments]:not([data-comments-bound])')]
  if (sections.length === 0) return

  const serverURL = 'https://my-waline-pink.vercel.app'
  const styleHref = 'https://cdn.jsdelivr.net/npm/@waline/client@3.7.1/dist/waline.css'

  const loadStyles = (signal) => new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Comments page was left', 'AbortError'))
      return
    }
    let link = document.querySelector(`link[href="${styleHref}"]`)
    if (link instanceof HTMLLinkElement && link.sheet) return resolve()

    const shouldAppend = !(link instanceof HTMLLinkElement)
    if (shouldAppend) {
      link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = styleHref
    }

    if (!(link instanceof HTMLLinkElement)) {
      reject(new Error('Waline stylesheet link could not be created'))
      return
    }

    const cleanup = () => {
      link.removeEventListener('load', onLoad)
      link.removeEventListener('error', onError)
      signal.removeEventListener('abort', onAbort)
    }
    const onLoad = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      link.remove()
      reject(new Error('Waline stylesheet failed to load'))
    }
    const onAbort = () => {
      cleanup()
      if (shouldAppend) link.remove()
      reject(new DOMException('Comments page was left', 'AbortError'))
    }
    link.addEventListener('load', onLoad, { once: true })
    link.addEventListener('error', onError, { once: true })
    signal.addEventListener('abort', onAbort, { once: true })

    if (shouldAppend) document.head.append(link)
  })

  const loadModule = () => {
    if (window.__nisconderWalineModule) return window.__nisconderWalineModule
    // Keep this import literal: Astro must see the external dynamic dependency
    // before deciding whether to inline the controller. A variable import can
    // be folded too late and leave Vite's preload placeholder in inline HTML.
    const module = import('https://cdn.jsdelivr.net/npm/@waline/client@3.7.1/dist/waline.js')
    window.__nisconderWalineModule = module
    module.catch(() => {
      if (window.__nisconderWalineModule === module) {
        delete window.__nisconderWalineModule
      }
    })
    return module
  }

  const bindSection = (section) => {
    if (!(section instanceof HTMLElement)) return
    const root = section.querySelector('[data-waline-root]')
    const status = section.querySelector('[data-waline-status]')
    const body = section.querySelector('[data-comments-body]')
    const toggle = section.querySelector('[data-comments-toggle]')
    const toggleLabel = section.querySelector('[data-comments-toggle-label]')
    if (
      !(root instanceof HTMLElement)
      || !(status instanceof HTMLElement)
      || !(body instanceof HTMLElement)
      || !(toggle instanceof HTMLButtonElement)
    ) return
    section.dataset.commentsBound = 'true'
    const loginStatus = section.querySelector('[data-waline-login-status]')
    const disposeLoginFeedback = loginStatus instanceof HTMLElement
      ? bindWalineLoginFeedback(root, loginStatus, serverURL)
      : undefined

    const lifecycle = new AbortController()
    const mobileQuery = window.matchMedia('(max-width: 44rem)')
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let disposed = false
    let observer
    let bodyAnimation
    let rootAnimation
    let bodyHideTimer
    let scrollFrame
    let disclosureRevision = 0
    const active = () => !disposed && section.isConnected && root.isConnected

    const setExpanded = (expanded, animate = false) => {
      if (!active()) return
      const revision = ++disclosureRevision
      window.clearTimeout(bodyHideTimer)
      bodyAnimation?.cancel()
      toggle.hidden = !mobileQuery.matches
      toggle.setAttribute('aria-expanded', String(expanded))
      if (toggleLabel) toggleLabel.textContent = expanded ? '收起留言' : '展开留言'
      section.dataset.commentsExpanded = String(expanded)

      if (!animate || reducedMotion.matches) {
        body.hidden = !expanded
        body.inert = !expanded
        body.setAttribute('aria-hidden', String(!expanded))
        return
      }

      if (expanded) {
        body.hidden = false
        body.inert = false
        body.setAttribute('aria-hidden', 'false')
        bodyAnimation = body.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
        return
      }

      if (body.contains(document.activeElement)) toggle.focus()
      body.inert = true
      body.setAttribute('aria-hidden', 'true')
      bodyAnimation = body.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        { duration: 120, easing: 'ease-in', fill: 'forwards' },
      )
      const finishCollapse = () => {
        if (active() && revision === disclosureRevision && section.dataset.commentsExpanded === 'false') {
          body.hidden = true
        }
      }
      bodyAnimation.finished.catch(() => undefined).then(finishCollapse)
      bodyHideTimer = window.setTimeout(finishCollapse, 160)
    }

    const showRetry = () => {
      if (!active()) return
      status.replaceChildren('留言加载失败。 ')
      const retry = document.createElement('button')
      retry.type = 'button'
      retry.className = 'button secondary'
      retry.textContent = '重新加载'
      retry.addEventListener('click', () => {
        root.__walineInstance?.destroy?.()
        delete root.__walineInstance
        root.replaceChildren()
        root.dataset.walineState = 'idle'
        retry.remove()
        loadComments()
      }, { once: true, signal: lifecycle.signal })
      status.append(retry)
    }

    const loadComments = async () => {
      if (!active() || document.prerendering) return
      if (root.dataset.walineState === 'loading' || root.dataset.walineState === 'ready') return
      root.dataset.walineState = 'loading'
      status.textContent = '正在加载留言…'

      try {
        const [, module] = await Promise.all([loadStyles(lifecycle.signal), loadModule()])
        if (!active()) return
        root.replaceChildren()
        root.__walineInstance = module.init({
          el: root,
          serverURL,
          path: root.dataset.walinePath,
          lang: 'zh-CN',
          login: 'enable',
          dark: "html[data-theme='dark']",
        })
        root.dataset.walineState = 'ready'
        status.remove()
        if (!reducedMotion.matches) {
          rootAnimation = root.animate(
            [{ opacity: 0 }, { opacity: 1 }],
            { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          )
        }
      } catch {
        if (!active()) return
        root.__walineInstance?.destroy?.()
        delete root.__walineInstance
        root.replaceChildren()
        root.dataset.walineState = 'error'
        showRetry()
      }
    }

    const observeComments = () => {
      if (!active() || body.hidden || root.dataset.walineState === 'ready') return
      if ('IntersectionObserver' in window) {
        observer?.disconnect()
        observer = new IntersectionObserver((entries) => {
          if (!active() || !entries.some((entry) => entry.isIntersecting)) return
          observer.disconnect()
          loadComments()
        }, { rootMargin: '150px 0px' })
        observer.observe(section)
      } else {
        loadComments()
      }
    }

    const dispose = () => {
      if (disposed) return
      disposed = true
      disclosureRevision += 1
      lifecycle.abort()
      disposeLoginFeedback?.()
      observer?.disconnect()
      window.clearTimeout(bodyHideTimer)
      cancelAnimationFrame(scrollFrame)
      bodyAnimation?.cancel()
      rootAnimation?.cancel()
      try {
        root.__walineInstance?.destroy?.()
      } finally {
        delete root.__walineInstance
      }
    }

    document.addEventListener('astro:before-swap', (event) => {
      const swap = event.swap
      // Keep Waline intact through the exit animation, then unmount while its head styles still exist.
      event.swap = () => {
        dispose()
        swap.call(event)
      }
    }, { signal: lifecycle.signal })

    if (mobileQuery.matches) {
      setExpanded(false)
    } else {
      setExpanded(true)
      observeComments()
    }

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true'
      setExpanded(expanded, true)
      if (expanded) {
        loadComments()
        cancelAnimationFrame(scrollFrame)
        scrollFrame = requestAnimationFrame(() => {
          if (active()) body.scrollIntoView({ block: 'nearest' })
        })
      } else {
        observer?.disconnect()
      }
    }, { signal: lifecycle.signal })

    mobileQuery.addEventListener?.('change', (event) => {
      if (event.matches) {
        setExpanded(false)
        observer?.disconnect()
      } else {
        setExpanded(true)
        observeComments()
      }
    }, { signal: lifecycle.signal })
  }

  sections.forEach(bindSection)
}
