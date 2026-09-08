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
  build: {
    format: 'directory',
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
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      wrap: true,
    },
  },
})
