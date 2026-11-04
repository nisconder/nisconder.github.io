import type { APIRoute } from 'astro'
import { getPublishedSeries } from '../lib/series'
import { softwareKindLabels, softwareProjects, softwareStatusLabels } from '../data/software'
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
  const series = await getPublishedSeries()
  const seriesIndex = series.map(item => ({
    kind: '合集',
    title: item.data.title,
    description: item.data.description,
    content: item.posts.map(post => post.data.title).join(' '),
    category: '系列笔记',
    tags: [...new Set(item.posts.flatMap(getPostTags))],
    url: item.href,
  }))
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
    kind: '项目',
    title: project.name,
    description: project.summary,
    content: [
      softwareKindLabels[project.kind],
      softwareStatusLabels[project.status],
      project.language,
      ...project.tags,
    ].filter(Boolean).join(' '),
    date: project.updatedAt,
    category: softwareKindLabels[project.kind],
    tags: project.tags,
    url: `/software/#${project.slug}`,
  }))

  return new Response(JSON.stringify([...postIndex, ...seriesIndex, ...softwareIndex]), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  })
}
