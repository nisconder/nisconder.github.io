/** Only pointer movement requests a frame. The hit area stays flat above the moving chassis. */
export function bindDeckTilt(stage: HTMLElement, chassis: HTMLElement, signal: AbortSignal) {
  const allowed = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
  let frame = 0
  let clientX = 0
  let clientY = 0
  const options = { passive: true, signal }

  const rest = () => {
    cancelAnimationFrame(frame)
    frame = 0
    stage.removeAttribute('data-tilting')
    chassis.style.removeProperty('transform')
  }
  const move = (event: PointerEvent) => {
    if (!allowed.matches || event.pointerType === 'touch' || document.hidden) return
    clientX = event.clientX
    clientY = event.clientY
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const box = stage.getBoundingClientRect()
      if (!box.width || !box.height) return
      const x = Math.max(-1, Math.min(1, 2 * (clientX - box.left) / box.width - 1))
      const y = Math.max(-1, Math.min(1, 2 * (clientY - box.top) / box.height - 1))
      stage.setAttribute('data-tilting', '')
      chassis.style.transform = `rotateX(${(10 - y * 10).toFixed(1)}deg) rotateY(${(-5 + x * 14).toFixed(1)}deg) rotateZ(-2deg)`
    })
  }
  stage.addEventListener('pointermove', move, options)
  stage.addEventListener('pointerleave', rest, options)
  stage.addEventListener('pointercancel', rest, options)
  document.addEventListener('visibilitychange', rest, { signal })
  allowed.addEventListener('change', rest, { signal })
  signal.addEventListener('abort', rest, { once: true })
}
