import { chapterLabel } from './chapter-label'

type Chapter = [title: string, href: string]

export class ChapterFolio extends HTMLElement {
  private events?: AbortController
  private chapters?: Chapter[]
  private page = 0
  private outgoing?: Animation
  private incoming?: Animation

  connectedCallback() {
    const list = this.querySelector('ol')
    const pager = this.querySelector<HTMLElement>('[data-pager]')
    const spare = this.dataset.remaining
    if (!list || !pager || !spare) return
    const rows = Array.from(list.querySelectorAll('li'), row => ({
      row, number: row.querySelector('span')!, link: row.querySelector('a')!,
    }))
    this.chapters ??= [
      ...rows.map(({ link }): Chapter => [link.getAttribute('aria-label') || link.textContent || '', link.getAttribute('href')!]),
      ...JSON.parse(spare) as Chapter[],
    ]
    const chapters = this.chapters
    const lastPage = Math.ceil(chapters.length / rows.length) - 1
    const output = pager.querySelector('output')!
    const previous = pager.querySelector<HTMLButtonElement>('[data-step="-1"]')!
    const next = pager.querySelector<HTMLButtonElement>('[data-step="1"]')!
    const reduce = matchMedia('(prefers-reduced-motion: reduce)')
    this.events = new AbortController()
    const options = { signal: this.events.signal }

    const turn = (step: number) => {
      const destination = this.page + step
      if (destination < 0 || destination > lastPage) return
      this.stopTurn()
      // Only the old sheet is decorative. The new chapter links work immediately.
      const leaf = !reduce.matches && list.animate ? list.cloneNode(true) as HTMLOListElement : null
      this.page = destination
      rows.forEach(({ row, number, link }, slot) => {
        const index = destination * rows.length + slot
        const chapter = chapters[index]
        row.hidden = !chapter
        if (!chapter) return
        const label = chapterLabel(chapter[0])
        number.textContent = label.number
        link.textContent = label.title
        link.setAttribute('aria-label', chapter[0])
        link.setAttribute('href', chapter[1])
      })
      output.textContent = (destination + 1) + ' / ' + (lastPage + 1)
      previous.setAttribute('aria-disabled', String(destination === 0))
      next.setAttribute('aria-disabled', String(destination === lastPage))
      if (!leaf) return
      leaf.inert = true
      leaf.setAttribute('aria-hidden', 'true')
      leaf.setAttribute('data-leaf-out', '')
      leaf.style.transformOrigin = step > 0 ? 'left center' : 'right center'
      list.after(leaf)
      this.outgoing = leaf.animate([
        { transform: 'rotateY(0deg)', opacity: 1 },
        { transform: `rotateY(${-step * 56}deg)`, opacity: 0.92, offset: 0.48 },
        { transform: `rotateY(${-step * 97}deg)`, opacity: 0 },
      ], { duration: 460, easing: 'cubic-bezier(.32,.02,.22,1)', fill: 'forwards' })
      this.outgoing.onfinish = () => leaf.remove()
      this.incoming = list.animate([
        { transform: `rotateY(${step * 11}deg)`, opacity: 0.45 },
        { transform: 'rotateY(0deg)', opacity: 1 },
      ], { duration: 430, easing: 'ease-out' })
    }
    previous.addEventListener('click', () => turn(-1), options)
    next.addEventListener('click', () => turn(1), options)
    reduce.addEventListener('change', () => this.stopTurn(), options)
    pager.hidden = false
  }

  private stopTurn() {
    this.outgoing?.cancel()
    this.incoming?.cancel()
    this.querySelector('[data-leaf-out]')?.remove()
  }

  disconnectedCallback() {
    this.events?.abort()
    this.stopTurn()
  }
}
