import type { APIRoute } from 'astro'
import { softwareProjects } from '../data/software'
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
  const postIndex = posts.map((post) => ({
    kind: '文章',
    title: post.data.title,
    description: getPostDescription(post),
    content: getPostPlainText(post),
    date: formatPostDate(post.data.date),
    category: getPostCategory(post),
    tags: getPostTags(post),
    url: getPostUrl(post),
  }))
  const softwareIndex = softwareProjects.map((project) => ({
    kind: '软件',
    title: project.name,
    description: project.summary,
    content: [project.status, ...project.tags].join(' '),
    category: '软件园',
    tags: project.tags,
    url: `/software/#${project.slug}`,
  }))

  return new Response(JSON.stringify([...postIndex, ...softwareIndex]), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
