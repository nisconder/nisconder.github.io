import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'astro'

const root = fileURLToPath(new URL('../', import.meta.url))
const outDir = resolve(root, 'dist-series')
const cacheDir = resolve(root, '.astro/series-build')
const publicDir = resolve(cacheDir, 'public')
await mkdir(publicDir, { recursive: true })

let feedCount = 0

console.log('Building collection RSS feeds with the shared Astro content pipeline.')
console.log('Only /series/<slug>/rss.xml paths are prerendered; the normal site build remains unchanged.')

await build({
  root,
  outDir,
  cacheDir,
  publicDir,
  vite: { cacheDir: resolve(cacheDir, 'vite') },
  integrations: [{
    name: 'nisconder:series-feeds-only',
    hooks: {
      'astro:build:start': ({ setPrerenderer, logger }) => {
        setPrerenderer((defaultPrerenderer) => ({
          ...defaultPrerenderer,
          name: 'nisconder:series-feeds-only',
          async getStaticPaths() {
            const paths = await defaultPrerenderer.getStaticPaths()
            const feeds = paths.filter(({ pathname }) =>
              /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/rss\.xml\/?$/.test(pathname),
            )
            feedCount = feeds.length
            logger.info(`Prerendering ${feedCount} collection RSS feed(s).`)
            return feeds
          },
        }))
      },
    },
  }],
})

console.log(`Built ${feedCount} collection RSS feed(s) in ${outDir}`)
