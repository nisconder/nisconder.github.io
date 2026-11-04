import type { APIRoute } from 'astro'
import { getPostDescription, getPublishedPosts } from '../../lib/posts'

export const prerender = true

export const GET: APIRoute = async () => {
  // This static resource is public. Draft titles and descriptions must never
  // appear here; saving the widget still uses the authenticated CMS backend.
  const posts = await getPublishedPosts()
  return new Response(JSON.stringify({
    posts: posts.map((post) => ({
      id: post.id,
      title: post.data.title,
      description: getPostDescription(post),
      draft: false,
    })),
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
