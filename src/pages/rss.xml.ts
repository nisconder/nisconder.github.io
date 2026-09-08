import type { APIRoute } from 'astro'
import { getFeedIdentity } from '../lib/feed-identity'
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

const escapeCdata = (value: string) => value.replace(/]]>/g, ']]]]><![CDATA[>')

const absolutizeFeedHtml = (html: string, postUrl: string) =>
  html.replace(
    /\b(href|src)=(['"])(\/(?!\/)[^'"]*|\.{1,2}\/[^'"]*|#[^'"]*)\2/gi,
    (_match, attribute: string, quote: string, value: string) => {
      const absoluteUrl = new URL(value, postUrl).href.replace(/&/g, '&amp;')
      return `${attribute}=${quote}${absoluteUrl}${quote}`
    },
  )

export const GET: APIRoute = async ({ site, url }) => {
  const posts = await getPublishedPosts()
  const base = site ?? new URL(url.origin)
  const feedUrl = new URL('/rss.xml', base).href
  const homeUrl = new URL('/', base).href
  const latestChange = posts.reduce(
    (latest, post) => Math.max(
      latest,
      getPostInstant(post.data.updated ?? post.data.date).getTime(),
    ),
    0,
  )
  const lastBuildDate = new Date(latestChange).toUTCString()

  const items = posts.map((post) => {
    const postUrl = new URL(getPostUrl(post), base).href
    const identity = getFeedIdentity(post.id)
    const contentHtml = post.rendered?.html
      ? absolutizeFeedHtml(post.rendered.html, postUrl)
      : ''
    const categories = Array.from(new Set(
      [getPostCategory(post), ...getPostTags(post)].filter(
        (value): value is string => Boolean(value),
      ),
    ))

    return [
      '<item>',
      `<title>${escapeXml(post.data.title)}</title>`,
      `<link>${escapeXml(postUrl)}</link>`,
      `<guid isPermaLink="${identity.isPermaLink}">${escapeXml(identity.guid)}</guid>`,
      `<pubDate>${getPostInstant(post.data.date).toUTCString()}</pubDate>`,
      `<description>${escapeXml(getPostDescription(post))}</description>`,
      ...(contentHtml
        ? [`<content:encoded><![CDATA[${escapeCdata(contentHtml)}]]></content:encoded>`]
        : []),
      ...categories.map((category) => `<category>${escapeXml(category)}</category>`),
      '</item>',
    ].join('')
  }).join('')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '<channel>',
    '<title>Nisconder</title>',
    `<link>${escapeXml(homeUrl)}</link>`,
    '<description>技术文章、个人项目、阅读与音乐记录。</description>',
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
