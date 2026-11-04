/** @typedef {{ query: string, category: string, type: string }} SearchState */
/** @typedef {{ kind: string, title: string, description: string, date: string, category: string, tags: string[], href: string, search: {title: string, tags: string, category: string, description: string, content: string} }} SearchRecord */

export const normaliseSearch = (value) => String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-CN')

/** @returns {SearchRecord[]} */
export function prepareSearchRecords(items) {
  if (!Array.isArray(items)) throw new Error('Invalid search index')
  return items.map(item => {
    const href = String(item.url ?? item.href ?? '')
    if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) throw new Error('Invalid search result URL')
    const text = key => typeof item[key] === 'string' ? item[key] : ''
    const tags = Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string') : []
    const record = {
      kind: text('kind'), title: text('title'), description: text('description'),
      date: text('date'), category: text('category'), tags, href,
    }
    return { ...record, search: {
      title: normaliseSearch(record.title), tags: normaliseSearch(tags.join(' ')),
      category: normaliseSearch(record.category), description: normaliseSearch(record.description),
      content: normaliseSearch(text('content')),
    } }
  })
}

/** @returns {SearchState} */
export function readSearchState(parameters) {
  const query = parameters.get('q')?.trim() ?? ''
  const category = parameters.get('category')?.trim() ?? ''
  const requestedType = parameters.get('type') ?? ''
  const type = category ? 'article' : ['article', 'series', 'project'].includes(requestedType) ? requestedType : ''
  return { query, category, type }
}

/** @param {readonly SearchRecord[]} records @param {SearchState} state */
export function searchRecords(records, state, limit = 20) {
  const tokens = [...new Set(normaliseSearch(state.query).split(/\s+/).filter(Boolean))]
  const category = normaliseSearch(state.category)
  const kind = category ? '文章' : { article: '文章', series: '合集', project: '项目' }[state.type]
  if (!tokens.length && !category && !kind) return { matches: [], total: 0 }
  const matches = []
  for (const item of records) {
    if ((kind && item.kind !== kind) || (category && item.search.category !== category)) continue
    let score = tokens.length ? 0 : 1
    for (const token of tokens) {
      const fields = item.search
      const tokenScore = Number(fields.title.includes(token)) * 8
        + Number(fields.tags.includes(token)) * 5 + Number(fields.category.includes(token)) * 4
        + Number(fields.description.includes(token)) * 2 + Number(fields.content.includes(token))
      if (!tokenScore) { score = 0; break }
      score += tokenScore
    }
    if (score) matches.push({ item, score })
  }
  matches.sort((left, right) => right.score - left.score
    || right.item.date.localeCompare(left.item.date)
    || left.item.href.localeCompare(right.item.href))
  return { matches: matches.slice(0, limit), total: matches.length }
}
