import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

test('built HTML and scripts contain no unresolved Vite import placeholders', () => {
  const root = resolve(import.meta.dirname, '../../dist')
  const files = readdirSync(root, { recursive: true })
    .filter((file) => /\.(?:html|m?js)$/.test(file))
  assert.ok(files.length > 0, 'build the site before checking browser output')
  let walineImports = 0
  for (const file of files) {
    const source = readFileSync(resolve(root, file), 'utf8')
    assert.doesNotMatch(source, /\b__VITE_(?:PRELOAD|IS_MODERN)__\b/, `${file}: unresolved import helper`)
    if (/import\(["'`]https:\/\/cdn\.jsdelivr\.net\/npm\/@waline\/client@3\.7\.1\/dist\/waline\.js["'`]\)/.test(source)) walineImports += 1
  }
  assert.ok(walineImports > 0, 'the pinned Waline module remains available for lazy loading')
})
