import { createHash } from 'node:crypto'
import { getPublishedSeries } from './series'
import { softwareKindLabels, softwareProjects, softwareStatusLabels } from '../data/software'
import {
  formatPostDate, getPostCategory, getPostDescription, getPostPlainText,
  getPostTags, getPostUrl, getPublishedPosts,
} from './posts'

export async function getSearchIndexData() {
  const [posts, series] = await Promise.all([getPublishedPosts(), getPublishedSeries()])
  const items = [
    ...posts.map(post => ({
      kind: '文章', title: post.data.title, description: getPostDescription(post),
      content: getPostPlainText(post), date: formatPostDate(post.data.date),
      category: getPostCategory(post), tags: getPostTags(post), url: getPostUrl(post),
    })),
    ...series.map(item => ({
      kind: '合集', title: item.data.title, description: item.data.description,
      content: item.posts.map(post => post.data.title).join(' '), category: '系列笔记',
      tags: [...new Set(item.posts.flatMap(getPostTags))], url: item.href,
    })),
    ...softwareProjects.map(project => ({
      kind: '项目', title: project.name, description: project.summary,
      content: [softwareKindLabels[project.kind], softwareStatusLabels[project.status], project.language, ...project.tags].filter(Boolean).join(' '),
      date: project.updatedAt, category: softwareKindLabels[project.kind], tags: project.tags,
      url: `/software/#${project.slug}`,
    })),
  ]
  const json = JSON.stringify(items)
  const version = createHash('sha256').update(json).digest('hex').slice(0, 24)
  return { items, json, version, fullUrl: `/search-data/${version}.json` }
}
