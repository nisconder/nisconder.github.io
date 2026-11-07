import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeRepositories, mergeSoftwareProjects, SYNC_COMMIT_MESSAGE,
} from '../../src/data/software-sync.mjs'
import { fetchRepositories, fetchLatestCodeCommit, syncGitHubProjects } from '../sync-github-projects.mjs'
import { sortSoftwareProjects } from '../../src/data/software.ts'

const date = '2026-11-04T12:00:00Z'
const repo = (name, overrides = {}) => ({
  id: 1, name, owner: { login: 'nisconder' }, private: false, fork: false, archived: false,
  created_at: '2026-01-01T00:00:00Z', pushed_at: date, stargazers_count: 12,
  language: 'TypeScript', description: 'From GitHub', homepage: null, topics: ['tool'], ...overrides,
})
const snapshot = (repositories, syncedAt = date) => ({ version: 1, owner: 'nisconder', syncedAt, repositories })
const response = (body, headers = {}, status = 200) => new Response(JSON.stringify(body), { status, headers })
const codeCommit = (message = 'feat: new code', overrides = {}) => ({
  author: { login: 'nisconder' }, commit: { message, committer: { date } }, ...overrides,
})

async function temporarySnapshot(t, initial = snapshot([], null)) {
  const directory = await mkdtemp(join(tmpdir(), 'nisconder-project-sync-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const outputPath = join(directory, 'snapshot.json')
  await writeFile(outputPath, JSON.stringify(initial))
  return { directory, outputPath }
}

test('fetches all API pages with authenticated requests and stable name ordering', async () => {
  const requests = []
  const result = await fetchRepositories({ token: 'test-token', fetchImpl: async (url, options) => {
    requests.push(url)
    assert.equal(options.headers.Authorization, 'Bearer test-token')
    assert.equal(url.searchParams.get('per_page'), '100')
    assert.equal(url.searchParams.get('sort'), 'full_name')
    return url.searchParams.get('page') === '1'
      ? response([repo('a')], { link: '<https://api.github.com/users/nisconder/repos?page=2>; rel="next"' })
      : response([repo('b', { id: 2 })])
  } })
  assert.deepEqual(result.map(({ name }) => name), ['a', 'b'])
  assert.equal(requests.length, 2)
})

test('a full page without a Link header still checks the next page', async () => {
  let calls = 0
  const result = await fetchRepositories({ fetchImpl: async () => {
    calls += 1
    return response(calls === 1 ? Array.from({ length: 100 }, (_, i) => repo(`r${i}`, { id: i + 1 })) : [])
  } })
  assert.equal(result.length, 100)
  assert.equal(calls, 2)
})

test('rejects unexpected pagination hosts rather than forwarding a GitHub token', async () => {
  let calls = 0
  await assert.rejects(fetchRepositories({ fetchImpl: async () => {
    calls += 1
    return response([repo('a')], { link: '<https://example.org/repos?page=2>; rel="next"' })
  } }), /pagination/)
  assert.equal(calls, 1)
})

test('filters forks, archives, private repositories, the profile and blog infrastructure', () => {
  const repositories = [
    repo('original'), repo('fork', { id: 2, fork: true }), repo('old', { id: 3, archived: true }),
    repo('private', { id: 4, private: true }), repo('my-waline', { id: 5 }),
    repo('netlify-cms-github-oauth-provider', { id: 6 }), repo('nisconder', { id: 7 }),
  ]
  assert.deepEqual(normalizeRepositories(repositories).map(({ name }) => name), ['original'])
})

test('new numbered project names and their online homepage are included automatically', () => {
  const [project] = mergeSoftwareProjects(snapshot(normalizeRepositories([
    repo('8086-step-lab', { id: 1449359414, homepage: 'https://nisconder.github.io/8086-step-lab/' }),
  ])), [])
  assert.equal(project.slug, 'github-1449359414')
  assert.equal(project.name, '8086-step-lab')
  assert.equal(project.projectUrl, 'https://nisconder.github.io/8086-step-lab/')
})

test('rejects malformed/duplicate API data before replacing a reliable snapshot', () => {
  for (const bad of [repo('a', { stars: 1, stargazers_count: -1 }), repo('a', { pushed_at: 'invalid' }),
    repo('a', { owner: { login: 'someone-else' } }), repo('a', { topics: undefined })]) {
    assert.throws(() => normalizeRepositories([bad]), /snapshot retained/)
  }
  assert.throws(() => normalizeRepositories([repo('a'), repo('b')]), /duplicate/)
  assert.throws(() => normalizeRepositories([repo('a'), repo('A', { id: 2 })]), /duplicate/)
})

test('normalization is deterministic and ignores profile edits when deriving code update time', () => {
  const entries = [repo('z', { updated_at: '2099-01-01T00:00:00Z', topics: ['z', 'a', 'a'] }), repo('a', { id: 2 })]
  const original = structuredClone(entries)
  const result = normalizeRepositories(entries)
  assert.deepEqual(result.map(({ name }) => name), ['a', 'z'])
  assert.equal(result[1].pushedAt, date)
  assert.deepEqual(result[1].topics, ['a', 'z'])
  assert.deepEqual(entries, original)
})

test('live facts replace stale metrics while editorial copy, stable slug, and featured flag survive', () => {
  const editorial = [{ slug: 'custom-anchor', name: '中文名称', summary: '  中文简介\n', kind: 'game',
    status: 'stable', featured: true, label: 'CN', tags: ['人工标签'], stars: 999, language: 'Old',
    updatedAt: '2020-01-01', sourceUrl: 'https://github.com/nisconder/NewProject', projectUrl: '/special/' }]
  const original = structuredClone(editorial)
  const [merged] = mergeSoftwareProjects(snapshot(normalizeRepositories([repo('newproject', { language: null })])), editorial)
  assert.equal(merged.name, '中文名称')
  assert.equal(merged.summary, '中文简介')
  assert.equal(merged.slug, 'custom-anchor')
  assert.equal(merged.kind, 'game')
  assert.equal(merged.status, 'stable')
  assert.equal(merged.featured, true)
  assert.equal(merged.projectUrl, '/special/')
  assert.equal(merged.stars, 12)
  assert.equal(merged.language, undefined)
  assert.equal(merged.updatedAt, '2026-11-04')
  assert.deepEqual(merged.tags, ['人工标签'])
  assert.deepEqual(editorial, original)
})

test('new repositories appear automatically and deleted/private repositories leave after full sync', () => {
  const editorial = [{ name: 'Gone', sourceUrl: 'https://github.com/nisconder/gone', tags: [] }]
  const result = mergeSoftwareProjects(snapshot(normalizeRepositories([repo('new'), repo('gone', { id: 2, private: true })])), editorial)
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'new')
  assert.equal(result[0].summary, '这个项目的介绍还在整理，可以先到仓库里看看。')
  assert.deepEqual(mergeSoftwareProjects(snapshot([]), editorial), [])
})

test('missing and blank editorial descriptions never expose repository copy', () => {
  const normalized = normalizeRepositories([repo('new', { description: 'Raw repository pitch, not blog copy.' })])
  const original = structuredClone(normalized)
  const sourceUrl = 'https://github.com/nisconder/new'
  const cases = [[], [{ sourceUrl, name: '自定义名称' }],
    ...[undefined, null, '', ' \n\t '].map(summary => [{ sourceUrl, summary }])]
  for (const editorial of cases) {
    const [project] = mergeSoftwareProjects(snapshot(normalized), editorial)
    assert.equal(project.summary, '这个项目的介绍还在整理，可以先到仓库里看看。')
    assert.equal(project.sourceUrl, sourceUrl, 'new projects still have their live repository link')
    assert.equal(project.stars, 12)
  }
  assert.equal(normalized[0].description, 'Raw repository pitch, not blog copy.', 'raw descriptions remain available as source material')
  assert.deepEqual(normalized, original, 'rendering does not rewrite the snapshot')
})

test('later GitHub description edits cannot replace blog copy or its fallback', () => {
  const editorial = [{ sourceUrl: 'https://github.com/nisconder/known', summary: '从实际用途写起的博客简介。' }]
  const before = normalizeRepositories([repo('known'), repo('new', { id: 2 })])
  const after = normalizeRepositories([
    repo('known', { description: 'Changed upstream pitch', stargazers_count: 20, language: 'JavaScript' }),
    repo('new', { id: 2, description: 'Another upstream pitch', stargazers_count: 30 }),
  ])
  const initial = mergeSoftwareProjects(snapshot(before), editorial)
  const updated = mergeSoftwareProjects(snapshot(after), editorial)
  assert.deepEqual(updated.map(project => project.summary), initial.map(project => project.summary))
  assert.deepEqual(updated.map(project => project.stars), [20, 30], 'live facts continue to refresh')
  assert.equal(updated[0].language, 'JavaScript')
  assert.equal(after[0].description, 'Changed upstream pitch', 'sync still retains source descriptions')
})

test('pending initial snapshot preserves the existing catalog without presenting invented live data', () => {
  const editorial = [{ name: 'Existing', summary: '已有项目的博客简介。', tags: ['manual'] }]
  assert.deepEqual(mergeSoftwareProjects(snapshot([], null), editorial), editorial)
  assert.throws(() => mergeSoftwareProjects({ ...snapshot([]), owner: 'other' }, editorial), /Unsupported/)
})

test('pending initial snapshots also trim editorial copy and handle incomplete introductions', () => {
  const editorial = [{ name: 'Written', summary: '  简介已整理。\n', tags: [] }, { name: 'Unwritten', tags: [] }]
  const original = structuredClone(editorial)
  const result = mergeSoftwareProjects(snapshot([], null), editorial)
  assert.deepEqual(result.map(project => project.summary), ['简介已整理。', '这个项目的介绍还在整理，可以先到仓库里看看。'])
  assert.deepEqual(editorial, original)
})

test('empty repositories use their creation date, and unsafe homepage schemes are ignored', () => {
  const normalized = normalizeRepositories([repo('empty', { pushed_at: null, homepage: 'javascript:alert(1)', description: null })])
  assert.equal(normalized[0].projectUrl, null)
  const [project] = mergeSoftwareProjects(snapshot(normalized), [])
  assert.equal(project.updatedAt, '2026-01-01')
  assert.equal(project.summary, '这个项目的介绍还在整理，可以先到仓库里看看。')
})

test('sort keeps featured priority, uses live code dates, and does not mutate the input', () => {
  const projects = [
    { slug: 'z', name: 'Z', updatedAt: '2026-11-04' },
    { slug: 'a', name: 'A', updatedAt: '2026-01-01', featured: true },
    { slug: 'b', name: 'B', updatedAt: '2026-11-04' },
  ]
  const original = structuredClone(projects)
  assert.deepEqual(sortSoftwareProjects(projects).map(({ slug }) => slug), ['a', 'b', 'z'])
  assert.deepEqual(sortSoftwareProjects(projects, 'updated').map(({ slug }) => slug), ['b', 'z', 'a'])
  assert.deepEqual(sortSoftwareProjects(projects, 'name').map(({ slug }) => slug), ['a', 'b', 'z'])
  assert.deepEqual(projects, original)
})

test('the blog commit query skips only this automation, including across pages', async () => {
  const automated = codeCommit(SYNC_COMMIT_MESSAGE, { author: { login: 'github-actions[bot]' } })
  let calls = 0
  const result = await fetchLatestCodeCommit({ fetchImpl: async () => {
    calls += 1
    return calls === 1
      ? response([automated], { link: '<https://api.github.com/repos/nisconder/nisconder.github.io/commits?page=2>; rel="next"' })
      : response([codeCommit()])
  } })
  assert.equal(result, date)
  assert.equal(calls, 2)
  assert.equal(await fetchLatestCodeCommit({ fetchImpl: async () => response([codeCommit(SYNC_COMMIT_MESSAGE)]) }), date)
})

test('accepts GitHub numeric commit pagination after 100 commits while requesting the named repository', async () => {
  const automated = codeCommit(SYNC_COMMIT_MESSAGE, { author: { login: 'github-actions[bot]' } })
  const link = '<https://api.github.com/repositories/1096817490/commits?per_page=100&page=2>; rel="next"'
  for (const firstPageHasCode of [true, false]) {
    const requests = []
    const result = await fetchLatestCodeCommit({ token: 'test-token', fetchImpl: async (url, options) => {
      requests.push(url)
      assert.equal(url.origin, 'https://api.github.com')
      assert.equal(url.pathname, '/repos/nisconder/nisconder.github.io/commits')
      assert.equal(url.searchParams.get('page'), String(requests.length))
      assert.equal(options.headers.Authorization, 'Bearer test-token')
      if (requests.length === 2) return response([codeCommit()])
      const entries = Array.from({ length: 100 }, () => automated)
      if (firstPageHasCode) entries[0] = codeCommit()
      return response(entries, { link })
    } })
    assert.equal(result, date)
    assert.equal(requests.length, firstPageHasCode ? 1 : 2)
  }
})

test('canonical commit aliases do not permit unrelated hosts, paths, IDs or page numbers', async () => {
  const invalidLinks = [
    'https://example.org/repositories/1096817490/commits?page=2',
    'http://api.github.com/repositories/1096817490/commits?page=2',
    'https://api.github.com/repositories/1096817490/issues?page=2',
    'https://api.github.com/repos/another/repository/commits?page=2',
    'https://api.github.com/repositories/0/commits?page=2',
    'https://api.github.com/repositories/-1/commits?page=2',
    'https://api.github.com/repositories/not-an-id/commits?page=2',
    'https://api.github.com/repositories/1096817490/commits?page=3',
    'https://api.github.com/repositories/1096817490/commits',
    'not-a-url',
  ]
  for (const next of invalidLinks) {
    let calls = 0
    await assert.rejects(fetchLatestCodeCommit({ fetchImpl: async () => {
      calls += 1
      return response([codeCommit()], { link: `<${next}>; rel="next"` })
    } }), /Invalid GitHub pagination link/)
    assert.equal(calls, 1, next)
  }
  await assert.rejects(fetchRepositories({ fetchImpl: async () => response([repo('a')], {
    link: '<https://api.github.com/repositories/1096817490/commits?page=2>; rel="next"',
  }) }), /Invalid GitHub pagination link/, 'the numeric alias is limited to commit queries')
})

test('pagination failures preserve the snapshot and report safe request context', async (t) => {
  const { outputPath, directory } = await temporarySnapshot(t, snapshot([{ name: 'reliable' }]))
  const before = await readFile(outputPath, 'utf8')
  await assert.rejects(syncGitHubProjects({ outputPath, token: 'private-test-token', fetchImpl: async (url) =>
    url.pathname.endsWith('/commits') ? response([codeCommit()], {
      link: '<https://example.org/secret?token=private-test-token>; rel="next"',
      'x-github-request-id': 'ABCD:1234:5678',
    }) : response([repo('nisconder.github.io')]),
  }), (error) => {
    assert.match(error.message, /Invalid GitHub pagination link/)
    assert.match(error.message, /\/repos\/nisconder\/nisconder\.github\.io\/commits page=1, HTTP 200, GitHubRequestID=ABCD:1234:5678/)
    assert.doesNotMatch(error.message, /private-test-token|example\.org/)
    return true
  })
  assert.equal(await readFile(outputPath, 'utf8'), before)
  assert.deepEqual(await readdir(directory), ['snapshot.json'])
})

test('HTTP failures on later pages preserve the previous snapshot byte-for-byte', async (t) => {
  const { outputPath } = await temporarySnapshot(t, snapshot([{ name: 'reliable' }]))
  const before = await readFile(outputPath, 'utf8')
  for (const status of [403, 429, 500]) {
    let calls = 0
    await assert.rejects(syncGitHubProjects({ outputPath, fetchImpl: async () => {
      calls += 1
      return calls === 1 ? response([repo('a')], { link: '<https://api.github.com/users/nisconder/repos?page=2>; rel="next"' })
        : response({ message: 'failed' }, {}, status)
    } }), new RegExp(String(status)))
    assert.equal(await readFile(outputPath, 'utf8'), before)
  }
})

test('parse errors and failed self-commit queries preserve the old snapshot', async (t) => {
  const { outputPath } = await temporarySnapshot(t)
  const before = await readFile(outputPath, 'utf8')
  await assert.rejects(syncGitHubProjects({ outputPath, fetchImpl: async () => new Response('not json') }))
  await assert.rejects(syncGitHubProjects({ outputPath, fetchImpl: async (url) =>
    url.pathname.endsWith('/commits') ? response([], {}, 500) : response([repo('nisconder.github.io')]),
  }), /500/)
  assert.equal(await readFile(outputPath, 'utf8'), before)
})

test('publishes atomically and does not commit new timestamps or its own sync push repeatedly', async (t) => {
  const { outputPath, directory } = await temporarySnapshot(t)
  let pushed = date
  const fetchImpl = async (url) => url.pathname.endsWith('/commits')
    ? response([codeCommit(SYNC_COMMIT_MESSAGE, { author: { login: 'github-actions[bot]' } }), codeCommit()])
    : response([repo('nisconder.github.io', { pushed_at: pushed })])
  assert.deepEqual(await syncGitHubProjects({ outputPath, fetchImpl, now: () => new Date(date) }), { changed: true, count: 1 })
  const before = await readFile(outputPath, 'utf8')
  pushed = '2026-11-05T12:00:00Z'
  assert.deepEqual(await syncGitHubProjects({ outputPath, fetchImpl, now: () => new Date('2026-11-06') }), { changed: false, count: 1 })
  assert.equal(await readFile(outputPath, 'utf8'), before)
  assert.deepEqual(await readdir(directory), ['snapshot.json'])
})
