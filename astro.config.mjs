import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://nisconder-blog.netlify.app',
  output: 'static',
  publicDir: './static',
  trailingSlash: 'always',
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
