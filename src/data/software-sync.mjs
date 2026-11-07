export const GITHUB_OWNER = 'nisconder'
export const BLOG_REPOSITORY = 'nisconder.github.io'
export const SYNC_COMMIT_MESSAGE = 'chore: sync GitHub project snapshot'

// The GitHub profile and blog infrastructure are not standalone software projects.
export const EXCLUDED_REPOSITORIES = new Set([GITHUB_OWNER, 'my-waline', 'netlify-cms-github-oauth-provider'])
export const isProjectRepository = (repository) =>
  repository.private === false && repository.fork === false && repository.archived === false
  && !EXCLUDED_REPOSITORIES.has(repository.name.toLowerCase())

export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value))
}

/** Validate the complete API response before filtering or replacing a snapshot. */
export function normalizeRepositories(repositories, ownRepositoryDate, owner = GITHUB_OWNER) {
  const seenIds = new Set()
  const seenNames = new Set()
  return repositories.flatMap((repository) => {
    if (!repository || !Number.isSafeInteger(repository.id) || repository.id <= 0
      || typeof repository.name !== 'string' || !/^[\w.-]+$/.test(repository.name)
      || repository.owner?.login?.toLowerCase() !== owner.toLowerCase()
      || ['private', 'fork', 'archived'].some((key) => typeof repository[key] !== 'boolean')) {
      throw new Error('GitHub repository response is incomplete or belongs to another owner; snapshot retained.')
    }
    const key = repository.name.toLowerCase()
    if (seenIds.has(repository.id) || seenNames.has(key)) {
      throw new Error('GitHub pagination returned duplicate repositories; snapshot retained.')
    }
    seenIds.add(repository.id)
    seenNames.add(key)
    if (!isProjectRepository(repository)) return []
    if (!validDate(repository.created_at)
      || !(repository.pushed_at === null || validDate(repository.pushed_at))
      || !Number.isSafeInteger(repository.stargazers_count) || repository.stargazers_count < 0
      || !(repository.language === null || typeof repository.language === 'string')
      || !(repository.description === null || typeof repository.description === 'string')
      || !Array.isArray(repository.topics) || repository.topics.some((topic) => typeof topic !== 'string')) {
      throw new Error(`GitHub metadata is incomplete for ${repository.name}; snapshot retained.`)
    }
    const pushedAt = key === BLOG_REPOSITORY ? ownRepositoryDate : repository.pushed_at
    if (key === BLOG_REPOSITORY && !validDate(pushedAt)) {
      throw new Error('Cannot determine the blog’s latest non-sync commit; snapshot retained.')
    }
    return [{
      id: repository.id,
      name: repository.name,
      description: repository.description,
      sourceUrl: `https://github.com/${owner}/${repository.name}`,
      projectUrl: safeHomepage(repository.homepage),
      language: repository.language,
      stars: repository.stargazers_count,
      createdAt: repository.created_at,
      pushedAt,
      topics: [...new Set(repository.topics)].sort(),
    }]
  }).sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase(), 'en'))
}

function safeHomepage(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch { return null }
}

const pendingProjectSummary = '这个项目的介绍还在整理，可以先到仓库里看看。'
const editorialSummary = project =>
  (typeof project?.summary === 'string' ? project.summary.trim() : '') || pendingProjectSummary

/** Live facts update independently of the blog's editorial copy and stable anchors. */
export function mergeSoftwareProjects(snapshot, editorial) {
  if (snapshot.version !== 1 || snapshot.owner !== GITHUB_OWNER || !Array.isArray(snapshot.repositories)) {
    throw new Error('Unsupported GitHub project snapshot')
  }
  if (snapshot.syncedAt === null) {
    return editorial.filter((project) => project.fork !== true && project.archived !== true)
      .map((project) => ({ ...project, summary: editorialSummary(project), tags: [...project.tags] }))
  }
  if (!validDate(snapshot.syncedAt)) throw new Error('Invalid GitHub project snapshot timestamp')
  const overrides = new Map(editorial.map((project) => [
    project.sourceUrl?.split('/').at(-1)?.toLowerCase(), project,
  ]))
  return snapshot.repositories.map((repository) => {
    const override = overrides.get(repository.name.toLowerCase())
    return {
      // Numeric GitHub IDs remain stable when a new repository is renamed, and
      // avoid colliding with an existing hand-written project's anchor.
      slug: `github-${repository.id}`,
      name: repository.name,
      label: repository.name.slice(0, 2).toUpperCase(),
      kind: 'tool',
      status: 'experimental',
      ...(repository.projectUrl ? { projectUrl: repository.projectUrl, actionLabel: '访问项目' } : {}),
      ...override,
      // Repository descriptions remain source material in the snapshot, never
      // display copy. Empty or partial editorial entries use the same fallback.
      summary: editorialSummary(override),
      // Missing live repositories are never restored from the editorial list.
      sourceUrl: repository.sourceUrl,
      language: repository.language ?? undefined,
      stars: repository.stars,
      updatedAt: (repository.pushedAt ?? repository.createdAt).slice(0, 10),
      tags: [...(override?.tags ?? repository.topics)],
    }
  })
}
