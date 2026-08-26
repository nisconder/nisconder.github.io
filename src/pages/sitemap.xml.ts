import type { APIRoute } from 'astro'
import {
  formatPostDate,
  getPostUrl,
  getPublishedPosts,
} from '../lib/posts'

export const prerender = true

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

export const GET: APIRoute = async ({ site, url }) => {
  const posts = await getPublishedPosts()
  const base = site ?? new URL(url.origin)
  const staticPaths = ['/', '/articles/', '/about/', '/search/', '/music/', '/software/']

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

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...staticEntries,
    ...postEntries,
    '</urlset>',
  ].join('')

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
