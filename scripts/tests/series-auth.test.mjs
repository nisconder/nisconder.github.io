import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = file => readFileSync(resolve(root, file), 'utf8')

test('series saves use the existing authenticated GitHub repository backend', () => {
  const config = read('source/admin/config.yml')
  const backend = config.match(/^backend:\s*\n([\s\S]*?)^locale:/m)?.[1]
  assert.ok(backend, 'One production backend is required')
  assert.match(backend, /^  name: github$/m)
  assert.match(backend, /^  repo: nisconder\/nisconder\.github\.io$/m)
  assert.match(backend, /^  branch: main$/m)
  assert.match(backend, /^  base_url: https:\/\/netlify-cms-github-oauth-provider-khaki\.vercel\.app$/m)
  assert.match(backend, /^  auth_endpoint: \/auth$/m)
  assert.doesNotMatch(config, /^local_backend:|name:\s*(test-repo|proxy)\b/m)
  const series = config.slice(config.indexOf('  - name: series\n'))
  assert.match(series, /folder: source\/_series/)
  assert.match(series, /allow_reorder: true/)
  assert.match(series, /widget: relation[\s\S]*collection: posts[\s\S]*value_field: '\{\{slug\}\}'/)
  assert.doesNotMatch(series, /(?:^|\n)\s*backend:/)
})

test('production admin contains no disposable repository or anonymous backend override', () => {
  for (const file of ['source/admin/content/index.html', 'source/admin/admin-ui.js']) {
    assert.doesNotMatch(read(file), /test-repo|repoFiles|local_backend|name:\s*['"]proxy['"]/, file)
  }
  assert.equal(read('dist/admin/config.yml'), read('source/admin/config.yml'))
  assert.doesNotMatch(read('dist/admin/content/index.html'), /test-repo|repoFiles|local_backend/)
  assert.equal(existsSync(resolve(root, 'dist/scripts/preview-admin.mjs')), false)
})

test('the disposable editor preview is loopback-only and read-only at the HTTP boundary', () => {
  const preview = read('scripts/preview-admin.mjs')
  assert.match(preview, /\.listen\(port, '127\.0\.0\.1'/)
  assert.match(preview, /request\.method !== 'GET' && request\.method !== 'HEAD'/)
  assert.match(preview, /writeHead\(405\)/)
  assert.doesNotMatch(preview, /writeFile|appendFile|execSync|spawn\(/)
})
