import type { APIRoute } from 'astro'
import { getPublishedPosts } from '../lib/posts'
import { renderRssFeed } from '../lib/rss'

export const prerender = true

export const GET: APIRoute = async ({ site, url }) => new Response(renderRssFeed({
  posts: await getPublishedPosts(),
  base: site ?? url.origin,
}), {
  headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
})
