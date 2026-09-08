// Indicate network preparation, not a fabricated loading percentage. Leave the
// page interactive and clear feedback on success, failure, or superseding clicks.
export function installNavigationFeedback(document, timers = globalThis) {
  let revision = 0
  let timeout
  let visible = false

  const render = () => {
    if (visible) document.documentElement.setAttribute('data-navigation-loading', '')
    else document.documentElement.removeAttribute('data-navigation-loading')
    const status = document.querySelector('[data-navigation-status]')
    if (status) status.textContent = visible ? '正在打开页面…' : ''
  }

  const clear = () => {
    timers.clearTimeout(timeout)
    visible = false
    render()
  }

  const beforePreparation = (event) => {
    const current = ++revision
    clear()
    if (event.signal.aborted) return

    const finish = () => {
      if (current === revision) clear()
    }
    timeout = timers.setTimeout(() => {
      if (current !== revision || event.signal.aborted) return
      visible = true
      render()
    }, 150)
    event.signal.addEventListener('abort', finish, { once: true })

    const loader = event.loader
    event.loader = async () => {
      try {
        return await loader.call(event)
      } finally {
        event.signal.removeEventListener('abort', finish)
        finish()
      }
    }
  }

  document.addEventListener('astro:before-preparation', beforePreparation)
  // A previous fallback animation may swap the DOM while a newer request waits.
  document.addEventListener('astro:after-swap', render)
  return () => {
    revision += 1
    clear()
    document.removeEventListener('astro:before-preparation', beforePreparation)
    document.removeEventListener('astro:after-swap', render)
  }
}
