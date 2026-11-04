import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import yaml from 'js-yaml'

test('public chapter-picker metadata includes published posts and excludes draft identities', () => {
  const root = new URL('../../', import.meta.url)
  const data = JSON.parse(readFileSync(new URL('dist/admin/post-options.json', root), 'utf8'))
  const byId = new Map(data.posts.map(post => [post.id, post]))
  assert.equal(byId.size, data.posts.length)
  const folder = new URL('source/_posts/', root)
  for (const filename of readdirSync(folder).filter(name => name.endsWith('.md'))) {
    const raw = readFileSync(new URL(filename, folder), 'utf8')
    const fields = yaml.load(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1])
    const id = filename.slice(0, -3)
    if (fields.draft === true) {
      assert.ok(!byId.has(id), `draft ${id} must not leak through public metadata`)
    } else {
      assert.equal(byId.get(id)?.title, fields.title)
      assert.equal(byId.get(id)?.draft, false)
      assert.equal(typeof byId.get(id)?.description, 'string')
    }
  }
})
