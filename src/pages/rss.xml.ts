import type { APIRoute } from 'astro'
import {
  getPostCategory,
  getPostDescription,
  getPostInstant,
  getPostTags,
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
  const feedUrl = new URL('/rss.xml', base).href
  const homeUrl = new URL('/', base).href
  const lastBuildDate = posts[0]
    ? getPostInstant(posts[0].data.updated ?? posts[0].data.date).toUTCString()
    : new Date(0).toUTCString()

  const items = posts.map((post) => {
    const postUrl = new URL(getPostUrl(post), base).href
    const categories = Array.from(new Set(
      [getPostCategory(post), ...getPostTags(post)].filter(
        (value): value is string => Boolean(value),
      ),
    ))

    return [
      '<item>',
      `<title>${escapeXml(post.data.title)}</title>`,
      `<link>${escapeXml(postUrl)}</link>`,
      `<guid isPermaLink="true">${escapeXml(postUrl)}</guid>`,
      `<pubDate>${getPostInstant(post.data.date).toUTCString()}</pubDate>`,
      `<description>${escapeXml(getPostDescription(post))}</description>`,
      ...categories.map((category) => `<category>${escapeXml(category)}</category>`),
      '</item>',
    ].join('')
  }).join('')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '<title>不知名博客</title>',
    `<link>${escapeXml(homeUrl)}</link>`,
    '<description>Nisconder 的技术、生活与思考。</description>',
    '<language>zh-CN</language>',
    `<lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
    items,
    '</channel>',
    '</rss>',
  ].join('')

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
