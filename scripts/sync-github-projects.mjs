import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  BLOG_REPOSITORY, GITHUB_OWNER, SYNC_COMMIT_MESSAGE,
  isProjectRepository, normalizeRepositories, validDate,
} from '../src/data/software-sync.mjs'

const API_ORIGIN = 'https://api.github.com'
const defaultOutput = new URL('../src/data/github-repositories.json', import.meta.url)

async function requestPage(path, page, { token, fetchImpl, cacheBust }) {
  const url = new URL(path, API_ORIGIN)
  url.searchParams.set('per_page', '100')
  url.searchParams.set('page', String(page))
  if (cacheBust) url.searchParams.set('_', String(cacheBust))
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'nisconder-blog-project-sync',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  })
  const rawRequestId = response.headers.get('x-github-request-id')
  const requestId = rawRequestId && /^[\w:-]{1,120}$/.test(rawRequestId) ? rawRequestId : 'unavailable'
  const failure = (reason) => new Error(`${reason}; ${url.pathname} page=${page}, HTTP ${response.status}, GitHubRequestID=${requestId}; snapshot retained.`)
  if (!response.ok) throw failure('GitHub API request failed')
  let items
  try { items = await response.json() } catch { throw failure('Invalid GitHub API JSON') }
  if (!Array.isArray(items) || items.length > 100) throw failure('Invalid GitHub API page')
  const next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
  if (next) {
    let nextUrl
    try { nextUrl = new URL(next) } catch { throw failure('Invalid GitHub pagination link') }
    // GitHub canonicalizes commit pagination links to the numeric repository ID.
    // This is only a next-page hint: callers still construct the named endpoint,
    // so a Link header never changes the repository or token destination.
    const canonicalCommitPath = url.pathname === `/repos/${GITHUB_OWNER}/${BLOG_REPOSITORY}/commits`
      && /^\/repositories\/[1-9]\d*\/commits$/.test(nextUrl.pathname)
    if (nextUrl.origin !== API_ORIGIN || (nextUrl.pathname !== url.pathname && !canonicalCommitPath)
      || Number(nextUrl.searchParams.get('page')) !== page + 1 || items.length === 0) {
      throw failure('Invalid GitHub pagination link')
    }
  }
  return { items, hasNext: Boolean(next) || items.length === 100 }
}

export async function fetchRepositories(options = {}) {
  const requestOptions = { fetchImpl: fetch, token: process.env.GITHUB_TOKEN, ...options }
  const repositories = []
  for (let page = 1; page <= 100; page += 1) {
    const result = await requestPage(`/users/${GITHUB_OWNER}/repos?type=owner&sort=full_name&direction=asc`, page, requestOptions)
    repositories.push(...result.items)
    if (!result.hasNext) return repositories
  }
  throw new Error('GitHub repository pagination exceeded the safety limit; snapshot retained.')
}

export async function fetchLatestCodeCommit(options = {}) {
  const requestOptions = { fetchImpl: fetch, token: process.env.GITHUB_TOKEN, ...options }
  for (let page = 1; page <= 100; page += 1) {
    const result = await requestPage(`/repos/${GITHUB_OWNER}/${BLOG_REPOSITORY}/commits`, page, requestOptions)
    for (const entry of result.items) {
      if (typeof entry?.commit?.message !== 'string' || !validDate(entry.commit?.committer?.date)) {
        throw new Error('Invalid GitHub commit metadata; snapshot retained.')
      }
      const isSync = entry.commit.message.split('\n')[0] === SYNC_COMMIT_MESSAGE
        && (entry.author?.login === 'github-actions[bot]' || entry.committer?.login === 'github-actions[bot]')
      if (!isSync) return entry.commit.committer.date
    }
    if (!result.hasNext) break
  }
  throw new Error('No non-sync blog commit found; snapshot retained.')
}

export async function syncGitHubProjects({ outputPath = defaultOutput, now = () => new Date(), ...options } = {}) {
  const target = outputPath instanceof URL ? fileURLToPath(outputPath) : resolve(outputPath)
  const previous = JSON.parse(await readFile(target, 'utf8'))
  const repositories = await fetchRepositories(options)
  const includesBlog = repositories.some((repo) => repo?.name?.toLowerCase() === BLOG_REPOSITORY && isProjectRepository(repo))
  const ownRepositoryDate = includesBlog ? await fetchLatestCodeCommit(options) : undefined
  const normalized = normalizeRepositories(repositories, ownRepositoryDate)
  if (previous.version === 1 && previous.owner === GITHUB_OWNER && validDate(previous.syncedAt)
    && JSON.stringify(previous.repositories) === JSON.stringify(normalized)) {
    return { changed: false, count: normalized.length }
  }
  const snapshot = { version: 1, owner: GITHUB_OWNER, syncedAt: now().toISOString(), repositories: normalized }
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
  return { changed: true, count: normalized.length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await syncGitHubProjects({ cacheBust: process.env.GITHUB_SYNC_CACHE_BUST })
    console.log(`${result.changed ? 'Updated' : 'Unchanged'} GitHub project snapshot: ${result.count} projects.`)
  } catch (error) {
    console.error(`Project sync failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    process.exitCode = 1
  }
}
