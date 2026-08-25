import type { APIRoute } from 'astro'
import { getPublishedPosts } from '../../lib/posts'

export const prerender = true

export const GET: APIRoute = async () => {
  // The endpoint is publicly reachable on a static host, so draft metadata must
  // remain private. Published tags still provide reusable writing suggestions.
  const posts = await getPublishedPosts()
  const tags = Array.from(
    new Set(posts.flatMap((post) => post.data.tags ?? []).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, 'zh-CN'))

  return new Response(JSON.stringify(tags), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
