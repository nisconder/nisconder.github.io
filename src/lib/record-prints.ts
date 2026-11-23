import prints from '../data/record-prints.json' with { type: 'json' }

// Stored indices refer to this exact set and order of illustrations.
const key = 'nisconder-record-prints:' + prints.join(',')
let assigned: Map<string, number> | undefined

function restore() {
  const entries = new Map<string, number>()
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || '[]')
    if (Array.isArray(saved)) {
      for (const pair of saved) {
        if (!Array.isArray(pair)) continue
        const [id, index] = pair
        if (typeof id === 'string' && Number.isInteger(index) && index >= 0 && index < prints.length) {
          entries.set(id, index)
        }
      }
    }
  } catch { /* A tab without storage can still keep its assignments in memory. */ }
  return entries
}

export function getRecordPrintPosition(id: string) {
  assigned ??= restore()
  let index = assigned.get(id)
  if (index === undefined) {
    const history = [...assigned.values()]
    const round = history.slice(history.length - history.length % prints.length)
    let choices = prints.map((_, i) => i).filter(i => !round.includes(i))
    if (choices.length > 1) choices = choices.filter(i => i !== history.at(-1))
    index = choices[Math.floor(Math.random() * choices.length)]
    assigned.set(id, index)
    try { sessionStorage.setItem(key, JSON.stringify([...assigned])) } catch { /* Memory remains valid. */ }
  }
  return `${100 * index / Math.max(1, prints.length - 1)}%`
}
