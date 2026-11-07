import { defineConfig } from 'astro/config'

const adminIndexes = new Map([
  ['/admin', '/admin/index.html'],
  ['/admin/', '/admin/index.html'],
  ['/admin/content', '/admin/content/index.html'],
  ['/admin/content/', '/admin/content/index.html'],
  ['/admin/comments', '/admin/comments/index.html'],
  ['/admin/comments/', '/admin/comments/index.html'],
])

const installAdminDirectoryIndexes = (server) => {
  server.middlewares.use((request, _response, next) => {
    if (!request.url) return next()

    const queryStart = request.url.indexOf('?')
    const pathname = queryStart === -1 ? request.url : request.url.slice(0, queryStart)
    const query = queryStart === -1 ? '' : request.url.slice(queryStart)
    const target = adminIndexes.get(pathname)
    if (target) request.url = `${target}${query}`

    next()
  })
}

const adminDirectoryIndex = {
  name: 'nisconder-admin-directory-index',
  enforce: 'pre',
  configureServer: installAdminDirectoryIndexes,
  configurePreviewServer: installAdminDirectoryIndexes,
}

export default defineConfig({
  site: 'https://nisconder.pages.dev',
  output: 'static',
  publicDir: './static',
  trailingSlash: 'ignore',
  prefetch: false,
  build: {
    format: 'directory',
    inlineStylesheets: 'always',
  },
  redirects: {
    '/archives': '/articles/',
    '/categories': '/articles/',
    '/tags': '/articles/',
    '/link': '/about/',
    '/movies': '/music/',
    '/resources': '/software/',
  },
  vite: {
    plugins: [adminDirectoryIndex],
    // Small standalone interactions (including search) arrive with the HTML.
    // Images and shared/dynamic modules keep their normal cacheable URLs.
    build: {
      cssCodeSplit: true,
      assetsInlineLimit: (file, content) => file.endsWith('.js') ? content.length < 16_384 : undefined,
    },
  },
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
      wrap: true,
    },
  },
})
