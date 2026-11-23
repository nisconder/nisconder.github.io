import { getCollection, type CollectionEntry } from 'astro:content'
import type { PostEntry } from './posts'
import { resolvePublishedSeries } from './series-order.mjs'

export interface BlogSeries {
  id: string
  data: CollectionEntry<'series'>['data']
  posts: PostEntry[]
  href: string
}

export function getReadingStages(series: BlogSeries) {
  const starts = new Map(series.data.stages?.map(stage => [stage.start, stage.title]))
  const published = new Map(series.posts.map(post => [post.id, post]))
  const groups: { title: string; posts: PostEntry[] }[] = []
  let group = { title: '', posts: [] as PostEntry[] }
  groups.push(group)
  for (const { post: id } of series.data.chapters) {
    const title = starts.get(id)
    if (title) {
      group = { title, posts: [] }
      groups.push(group)
    }
    const post = published.get(id)
    if (post) group.posts.push(post)
  }
  return groups.filter(stage => stage.posts.length)
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
