import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { syncGkd, validateRelease } from '../sync-gkd-subscription.mjs'

function fixture(version = 7, extra = {}) {
  const sub = { id: 20261113, name: 'Nisconder的GKD订阅', version, apps: [{ id: 'example.app' }], globalGroups: [], ...extra }
  const files = {
    'gkd.json5': Buffer.from(JSON.stringify(sub)),
    'gkd.version.json5': Buffer.from(JSON.stringify({ id: sub.id, version })),
  }
  files['release.json'] = Buffer.from(JSON.stringify({ ...sub,
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, {
      sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length,
    }])),
  }))
  return files
}

test('rejects corrupt content and conflicting identities before publishing', () => {
  const files = fixture()
  assert.equal(validateRelease(files).release.version, 7)
  assert.throws(() => validateRelease({ ...files, 'gkd.json5': Buffer.from(files['gkd.json5'] + ' ') }), /integrity/)
  assert.throws(() => validateRelease(fixture(7, { id: 123 })), /identity/)
})

test('mirrors complete releases, rejects same-version edits and downgrades', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gkd-blog-test-'))
  try {
    const from = join(root, 'input')
    await mkdir(from)
    const put = async (files) => Promise.all(Object.entries(files).map(([name, data]) => writeFile(join(from, name), data)))
    await put(fixture())
    assert.equal((await syncGkd({ root, from })).changed, true)
    assert.equal((await syncGkd({ root, from })).changed, false)
    await put(fixture(7, { author: 'changed' }))
    await assert.rejects(syncGkd({ root, from }), /version increment/)
    assert.deepEqual(await readFile(join(root, 'static/gkd/subscription.json5')), fixture()['gkd.json5'])
    await put(fixture(8))
    assert.equal((await syncGkd({ root, from })).version, 8)
    await put(fixture(7))
    await assert.rejects(syncGkd({ root, from }), /downgrade/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
