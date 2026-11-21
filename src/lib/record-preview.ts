const previewStates = {
  idle: ['试听', '歌单选曲'],
  loading: ['取消', '正在缓冲…'],
  playing: ['暂停', '正在播放'],
  paused: ['继续', '已暂停'],
  ended: ['重播', '播放完毕'],
  error: ['重试', '音频暂时无法播放'],
} as const

export function bindRecordPreview(deck: HTMLElement, audio: HTMLAudioElement, signal: AbortSignal) {
  const button = deck.querySelector<HTMLButtonElement>('[data-preview-toggle]')
  const surface = deck.querySelector<HTMLButtonElement>('[data-disc-surface]')
  const label = deck.querySelector('[data-control-label]')
  const status = deck.querySelector('[data-preview-status]')
  const title = deck.querySelector('[data-disc-title]')?.textContent ?? ''
  const source = deck.dataset.previewSrc
  if (!button || !surface || !label || !status || !source) return

  let state: keyof typeof previewStates = 'idle'
  let request = 0
  let passingAudio = false
  const options = { signal }
  const show = (next: keyof typeof previewStates) => {
    state = next
    const [action, message] = previewStates[next]
    deck.toggleAttribute('data-playing', next === 'playing')
    button.setAttribute('aria-label', action + '《' + title + '》')
    surface.setAttribute('aria-label', action + '《' + title + '》')
    label.textContent = action
    status.textContent = message
  }

  const toggle = async () => {
    const revision = ++request
    if (state === 'loading' || (!audio.paused && !audio.ended && !audio.error)) {
      audio.pause()
      show(audio.currentTime > 0 ? 'paused' : 'idle')
      return
    }
    if (!audio.hasAttribute('src')) audio.src = source
    else if (audio.error) audio.load()
    show('loading')
    try {
      await audio.play()
    } catch {
      if (request === revision && !signal.aborted && !passingAudio) show('error')
    }
  }
  button.addEventListener('click', toggle, options)
  surface.addEventListener('click', toggle, options)
  audio.addEventListener('playing', () => {
    if (!audio.paused && !audio.ended) show('playing')
  }, options)
  const buffering = () => { if (!audio.paused && !audio.ended) show('loading') }
  audio.addEventListener('waiting', buffering, options)
  audio.addEventListener('seeking', buffering, options)
  audio.addEventListener('stalled', () => {
    if (audio.readyState < audio.HAVE_FUTURE_DATA) buffering()
  }, options)
  audio.addEventListener('pause', () => {
    if (audio.paused && !audio.ended && !audio.error) show(audio.currentTime > 0 ? 'paused' : 'idle')
  }, options)
  audio.addEventListener('ended', () => show('ended'), options)
  audio.addEventListener('error', () => show('error'), options)

  deck.ownerDocument.addEventListener('astro:before-swap', event => {
    const id = deck.dataset.trackId
    const destination = event.to.searchParams.get('track')
    passingAudio = Boolean(id && (!destination || destination === id) && event.newDocument.querySelector('[data-music-studio]')
      && audio.hasAttribute('src') && !audio.error && !audio.ended)
    if (passingAudio) {
      // Astro moves this exact media element, including its buffer and playback position.
      audio.dataset.continueTrack = id
      audio.dataset.resume = String(!audio.paused)
    } else {
      audio.removeAttribute('data-astro-transition-persist')
      audio.pause()
    }
  }, options)
  deck.ownerDocument.defaultView?.addEventListener('pagehide', () => {
    ++request
    audio.pause()
  }, options)
  signal.addEventListener('abort', () => {
    ++request
    if (passingAudio || !audio.hasAttribute('src')) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }, { once: true })

  show('idle')
  button.hidden = false
  surface.hidden = false
}
