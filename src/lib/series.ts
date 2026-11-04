import { getCollection, type CollectionEntry } from 'astro:content'
import type { PostEntry } from './posts'
import { resolvePublishedSeries } from './series-order.mjs'

export interface BlogSeries {
  id: string
  data: CollectionEntry<'series'>['data']
  posts: PostEntry[]
  href: string
}

export async function getPublishedSeries(): Promise<BlogSeries[]> {
  const [entries, posts] = await Promise.all([
    getCollection('series'),
    getCollection('posts'),
  ])
  return resolvePublishedSeries(entries, posts)
}

export async function getSeriesForPost(postId: string): Promise<BlogSeries[]> {
  return (await getPublishedSeries()).filter((series) =>
    series.posts.some((post) => post.id === postId),
  )
}
