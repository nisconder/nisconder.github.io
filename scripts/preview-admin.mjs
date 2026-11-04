// Local-only visual QA of the real, pinned Decap UI. The built-in test-repo
// backend stores edits in window.repoFiles, never GitHub or the working tree.
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const port = Number(process.env.ADMIN_PREVIEW_PORT || 4341)
const files = new Map([
  ['/admin/admin-theme.css', ['source/admin/admin-theme.css', 'text/css']],
  ['/admin/admin-ui.js', ['source/admin/admin-ui.js', 'text/javascript']],
  ['/admin/editor-preview.css', ['source/admin/editor-preview.css', 'text/css']],
  ['/img/nisconder-avatar.png', ['source/img/nisconder-avatar.png', 'image/png']],
])

// Seed only the browser's disposable test repository, never a write-capable
// local backend. Both views share the same objects because test-repo uses a
// folder lookup for listing and a path tree when reading or saving entries.
async function seedPreviewRepository() {
  const folders = {}
  for (const name of ['_posts', '_series']) {
    const folder = `source/${name}`
    const entries = {}
    let names
    try { names = await readdir(resolve(root, folder)) } catch (error) {
      if (error.code === 'ENOENT') { folders[name] = entries; continue }
      throw error
    }
    for (const file of names.filter(name => name.endsWith('.md'))) {
      entries[file] = { path: `${folder}/${file}`, content: await readFile(resolve(root, folder, file), 'utf8') }
    }
    folders[name] = entries
  }
  const serialized = JSON.stringify(folders).replace(/</g, '\\u003c')
  return `window.repoFiles = { source: ${serialized} }; window.repoFiles['source/_posts'] = window.repoFiles.source._posts; window.repoFiles['source/_series'] = window.repoFiles.source._series; window.repoFilesUnpublished = {};`
}

createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end('Read-only preview server')
    return
  }
  const pathname = new URL(request.url, `http://127.0.0.1:${port}`).pathname
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  try {
    let content
    let type
    if (pathname === '/' || pathname === '/admin/content/' || pathname === '/admin/') {
      content = await readFile(resolve(root, 'source/admin/content/index.html'), 'utf8')
      const seed = await seedPreviewRepository()
      // A callback keeps $&, $' and other literal assembly text out of
      // String.replace's replacement-pattern expansion.
      content = content.replace('<head>', () => `<head><script>${seed}</script>`)
        .replace('<title>写作后台 — Nisconder</title>', '<title>本地编辑器验证 — 不连接 GitHub</title>')
      type = 'text/html; charset=utf-8'
    } else if (pathname === '/admin/config.yml') {
      content = await readFile(resolve(root, 'source/admin/config.yml'), 'utf8')
      if (!/^backend:\s*\r?\n[\s\S]+?^locale:/m.test(content)) throw new Error('Unexpected config structure')
      content = content.replace(/^backend:\s*\r?\n[\s\S]+?^locale:/m, 'backend:\n  name: test-repo\nlocale:')
        .replace(/^(site_url|display_url):.*$/gm, `$1: http://127.0.0.1:${port}`)
      type = 'text/yaml; charset=utf-8'
    } else if (pathname === '/admin/tag-options.json') {
      content = JSON.stringify(['技术', '项目复盘', '阅读', '随笔'])
      type = 'application/json'
    } else if (files.has(pathname)) {
      const [file, mime] = files.get(pathname)
      content = await readFile(resolve(root, file))
      type = mime
    } else {
      response.writeHead(404, headers).end('Not found')
      return
    }
    response.writeHead(200, { ...headers, 'Content-Type': type }).end(content)
  } catch (error) {
    response.writeHead(500, headers).end('Preview source could not be loaded')
    console.error(error.message)
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Decap 3.15.1 layout preview: http://127.0.0.1:${port}/admin/content/#/collections/posts/new`)
  console.log('Uses the built-in test-repo login. Edits exist only in the browser tab; no GitHub writes.')
})
