import type { APIRoute } from 'astro'
import {
  formatPostDate,
  getPostUrl,
  getPublishedPosts,
} from '../lib/posts'
import { getPublishedSeries } from '../lib/series'

export const prerender = true

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const GET: APIRoute = async ({ site, url }) => {
  const [posts, series] = await Promise.all([getPublishedPosts(), getPublishedSeries()])
  const base = site ?? new URL(url.origin)
  const staticPaths = ['/', '/articles/', '/series/', '/about/', '/music/', '/software/']

  const staticEntries = staticPaths.map((path) =>
    `<url><loc>${escapeXml(new URL(path, base).href)}</loc></url>`,
  )
  const postEntries = posts.map((post) => {
    const lastModified = post.data.updated ?? post.data.date
    return [
      '<url>',
      `<loc>${escapeXml(new URL(getPostUrl(post), base).href)}</loc>`,
      `<lastmod>${formatPostDate(lastModified)}</lastmod>`,
      '</url>',
    ].join('')
  })
  // Series have no publication timestamp: editing the reading order does not
  // change a chapter's date, and an invented lastmod would mislead crawlers.
  const seriesEntries = series.map((entry) =>
    `<url><loc>${escapeXml(new URL(entry.href, base).href)}</loc></url>`,
  )

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticEntries,
    ...postEntries,
    ...seriesEntries,
    '</urlset>',
  ].join('')

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
