import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'

const repository = 'nisconder/gkd-subscription'
const expectedId = 20261113
const expectedName = 'Nisconder的GKD订阅'
const blogRoot = fileURLToPath(new URL('..', import.meta.url))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

export function validateRelease(files) {
  const release = JSON.parse(files['release.json'])
  const subscription = JSON.parse(files['gkd.json5'])
  const version = JSON.parse(files['gkd.version.json5'])
  for (const value of [release, subscription, version]) {
    if (value.id !== expectedId || !Number.isSafeInteger(value.version) || value.version < 7
      || value.version !== release.version) throw new Error('Subscription identity/version mismatch')
  }
  if (release.name !== expectedName || subscription.name !== expectedName
    || !Array.isArray(subscription.apps) || !subscription.apps.length
    || !Array.isArray(subscription.globalGroups)) throw new Error('Invalid public subscription')
  for (const name of ['gkd.json5', 'gkd.version.json5']) {
    if (release.files?.[name]?.sha256 !== sha256(files[name])
      || release.files[name].bytes !== files[name].length) throw new Error(`Release integrity mismatch: ${name}`)
  }
  return { release, subscription }
}

async function request(url, { api = false, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'nisconder-gkd-subscription-sync',
      ...(api ? { Accept: 'application/vnd.github+json' } : {}),
      ...(api && process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`GKD download failed: HTTP ${response.status}`)
  const result = Buffer.from(await response.arrayBuffer())
  if (result.length > 8_000_000) throw new Error('GKD download exceeds expected size')
  return result
}

export async function syncGkd({ root = blogRoot, from, fetchImpl = fetch } = {}) {
  let commit
  if (!from) {
    const body = JSON.parse(await request(`https://api.github.com/repos/${repository}/commits/main`, { api: true, fetchImpl }))
    if (!/^[a-f0-9]{40}$/.test(body.sha)) throw new Error('Invalid public repository revision')
    commit = body.sha
  }
  const names = ['gkd.json5', 'gkd.version.json5', 'release.json']
  const files = Object.fromEntries(await Promise.all(names.map(async (name) => [name,
    from ? await readFile(join(from, name))
      : await request(`https://raw.githubusercontent.com/${repository}/${commit}/dist/${name}`, { fetchImpl }),
  ])))
  const { release } = validateRelease(files)
  const target = join(root, 'static/gkd')
  let previous
  try { previous = await readFile(join(target, 'subscription.json5')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (previous) {
    const old = JSON.parse(previous)
    if (old.id !== expectedId || !Number.isSafeInteger(old.version)) throw new Error('Invalid previous mirror')
    if (old.version > release.version) throw new Error('Refusing subscription downgrade')
    if (old.version === release.version && !previous.equals(files['gkd.json5'])) {
      throw new Error('Subscription changed without a version increment')
    }
  }
  // All downloads and checks finish before writing. Git publishes the three files together.
  await mkdir(target, { recursive: true })
  await mkdir(join(root, 'src/data'), { recursive: true })
  await writeFile(join(target, 'subscription.json5'), files['gkd.json5'])
  await writeFile(join(target, 'version.json5'), files['gkd.version.json5'])
  await writeFile(join(root, 'src/data/gkd-subscription.json'), `${JSON.stringify({
    id: release.id, name: release.name, version: release.version,
    counts: release.counts, sha256: release.files['gkd.json5'].sha256,
  }, null, 2)}\n`)
  return { version: release.version, changed: !previous?.equals(files['gkd.json5']), ...(commit ? { commit } : {}) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length && (args.length !== 2 || args[0] !== '--from')) throw new Error('Usage: node scripts/sync-gkd-subscription.mjs [--from DIST_DIR]')
  console.log(JSON.stringify(await syncGkd({ from: args[1] && resolve(args[1]) })))
}
