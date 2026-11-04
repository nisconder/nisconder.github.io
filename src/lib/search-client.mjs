import { prepareSearchRecords, searchRecords } from './search-core.mjs'

export function createFullIndexLoader(fetchImpl = fetch, { timeoutMs = 15_000 } = {}) {
  const requests = new Map()
  const ready = new Map()
  return {
    peek: (url) => ready.get(url),
    load(url) {
      if (!requests.has(url)) {
        const controller = new AbortController()
        let timeout
        const deadline = new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort()
            reject(new Error('Search index request timed out'))
          }, timeoutMs)
        })
        // Cover both the initial response and a stalled response body. Racing
        // also settles callers if a fetch implementation fails to honor abort.
        const payload = Promise.resolve().then(() => fetchImpl(url, {
          headers: { Accept: 'application/json' }, signal: controller.signal,
        }))
          .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return response.json()
          })
        const request = Promise.race([payload, deadline])
          .then(payload => {
            const records = prepareSearchRecords(payload)
            ready.set(url, records)
            return records
          })
          .catch(error => { requests.delete(url); throw error })
          .finally(() => clearTimeout(timeout))
        requests.set(url, request)
      }
      return requests.get(url)
    },
  }
}

// Module state survives ClientRouter swaps. Page cleanup never cancels another
// page's request; content-addressed URLs isolate deployments.
export const sharedFullIndex = createFullIndexLoader()
const compactIndexes = new Map()
export function getCompactIndex(url, items) {
  if (!compactIndexes.has(url)) compactIndexes.set(url, prepareSearchRecords(items))
  return compactIndexes.get(url)
}

export function createSearchSession({ compact, fullUrl, loader = sharedFullIndex, onResults }) {
  let revision = 0
  let disposed = false
  return {
    invalidate() { revision += 1 },
    dispose() { disposed = true; revision += 1 },
    run(state) {
      const current = ++revision
      const full = loader.peek(fullUrl)
      const needsFull = Boolean(state.query.trim()) && !full
      const immediate = searchRecords(full ?? compact, state)
      if (disposed) return Promise.resolve()
      onResults({ ...immediate, state, pending: needsFull, error: false })
      if (!needsFull) return Promise.resolve()
      return loader.load(fullUrl).then(records => {
        if (!disposed && current === revision) onResults({ ...searchRecords(records, state), state, pending: false, error: false })
      }).catch(() => {
        if (!disposed && current === revision) onResults({ ...immediate, state, pending: false, error: true })
      })
    },
  }
}
