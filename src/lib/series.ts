import { getCollection, type CollectionEntry } from 'astro:content'
import type { PostEntry } from './posts'
import { resolvePublishedSeries } from './series-order.mjs'

export interface BlogSeries {
  id: string
  data: CollectionEntry<'series'>['data']
  posts: PostEntry[]
  href: string
}

// Collection chapters remain published at their original URLs, but are browsed
// through their collection instead of appearing again in chronological lists.
export function getStandalonePosts(
  posts: readonly PostEntry[],
  series: readonly BlogSeries[],
): PostEntry[] {
  const chapterIds = new Set(series.flatMap((entry) => entry.posts.map((post) => post.id)))
  return posts.filter((post) => !chapterIds.has(post.id))
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
