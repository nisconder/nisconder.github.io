// Observe the official Waline login flow without reading or relaying credentials.
export function createWalineLoginFeedback({
  onStatus,
  schedule = setTimeout,
  cancel = clearTimeout,
  timeoutMs = 20000,
  updateTimeoutMs = 3000,
}) {
  let waiting = false
  let disposed = false
  let timer

  const clearTimer = () => {
    if (timer !== undefined) cancel(timer)
    timer = undefined
  }

  return {
    start() {
      if (disposed) return
      clearTimer()
      waiting = true
      onStatus('请在弹出的 Waline 窗口中完成登录。')
      timer = schedule(() => {
        timer = undefined
        if (!disposed && waiting) {
          onStatus('尚未收到登录结果。没有看到弹窗时，请允许浏览器打开弹窗；若弹窗已显示登录成功，请关闭它，再从这里点击“登录”重试。')
        }
      }, timeoutMs)
    },
    received(hasToken) {
      if (disposed || !waiting) return
      clearTimer()
      if (!hasToken) {
        onStatus('后台没有返回登录凭据。请在弹窗中退出后重新登录，再试一次。')
        return
      }
      onStatus('已收到登录结果，正在更新留言区…')
      timer = schedule(() => {
        timer = undefined
        if (!disposed && waiting) {
          onStatus('已收到登录结果，但留言区未更新。请先复制尚未提交的留言，再刷新本页重试。')
        }
      }, updateTimeoutMs)
    },
    connected() {
      if (disposed || !waiting) return
      waiting = false
      clearTimer()
      onStatus('留言账号已连接。')
    },
    dispose() {
      disposed = true
      waiting = false
      clearTimer()
    },
  }
}

// Only return a presence flag. Do not copy, log, persist, or display the payload.
export function getWalineLoginSignal(event, serverOrigin) {
  if (event.origin !== serverOrigin) return null
  const message = event.data
  if (!message || typeof message !== 'object' || message.type !== 'userInfo') return null
  return typeof message.data?.token === 'string' && message.data.token.length > 0
}

export function bindWalineLoginFeedback(root, status, serverURL) {
  const view = root.ownerDocument.defaultView
  const serverOrigin = new URL(serverURL).origin
  const feedback = createWalineLoginFeedback({
    onStatus(message) {
      status.textContent = message
      status.hidden = false
    },
  })
  const onClick = (event) => {
    // Waline 3.7.1 uses the non-primary footer button for login.
    // Do not cancel the click: its own popup and message handler stay in charge.
    const control = event.target?.closest?.('.wl-info .wl-btn:not(.primary)')
    if (control && root.contains(control)) feedback.start()
  }
  const observer = new MutationObserver(() => {
    if (root.querySelector('.wl-login-info')) feedback.connected()
  })
  const onMessage = (event) => {
    const signal = getWalineLoginSignal(event, serverOrigin)
    if (signal !== null) feedback.received(signal)
  }
  root.addEventListener('click', onClick, true)
  view.addEventListener('message', onMessage)
  observer.observe(root, { childList: true, subtree: true })

  return () => {
    feedback.dispose()
    observer.disconnect()
    root.removeEventListener('click', onClick, true)
    view.removeEventListener('message', onMessage)
  }
}
