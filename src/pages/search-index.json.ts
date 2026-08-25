import type { APIRoute } from 'astro'
import {
  formatPostDate,
  getPostCategory,
  getPostDescription,
  getPostPlainText,
  getPostTags,
  getPostUrl,
  getPublishedPosts,
} from '../lib/posts'

export const prerender = true

export const GET: APIRoute = async () => {
  const posts = await getPublishedPosts()
  const index = posts.map((post) => ({
    title: post.data.title,
    description: getPostDescription(post),
    content: getPostPlainText(post),
    date: formatPostDate(post.data.date),
    category: getPostCategory(post),
    tags: getPostTags(post),
    url: getPostUrl(post),
  }))

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
