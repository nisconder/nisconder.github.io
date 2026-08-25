import { access, cp, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const staticRoot = resolve(root, 'static')

const mappings = [
  ['source/admin', 'admin'],
  ['source/img', 'img'],
  ['source/images', 'images'],
]

await mkdir(staticRoot, { recursive: true })

for (const [sourcePath, targetPath] of mappings) {
  const source = resolve(root, sourcePath)
  try {
    await access(source, constants.R_OK)
  } catch {
    continue
  }

  await cp(source, resolve(staticRoot, targetPath), {
    recursive: true,
    force: true,
  })
}

console.log('Prepared static admin and media assets.')
