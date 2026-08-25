import { getCollection, type CollectionEntry } from 'astro:content'

export type PostEntry = CollectionEntry<'posts'>

const twoDigits = (value: number) => String(value).padStart(2, '0')

const asDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid post date: ${String(value)}`)
  }
  return date
}

const stickyWeight = (post: PostEntry) => {
  const sticky = post.data.sticky
  if (typeof sticky === 'number') return sticky
  return sticky === true ? 1 : 0
}

const sortPosts = (posts: PostEntry[]) =>
  posts.sort((left, right) => {
    const dateDifference = right.data.date.getTime() - left.data.date.getTime()
    if (dateDifference !== 0) return dateDifference

    return right.id.localeCompare(left.id, 'zh-CN')
  })

export async function getPublishedPosts(): Promise<PostEntry[]> {
  const posts = await getCollection('posts', ({ data }) => data.draft !== true)
  return sortPosts(posts)
}

export async function getFeaturedPost(
  posts?: PostEntry[],
): Promise<PostEntry | undefined> {
  const candidates = posts ? sortPosts([...posts]) : await getPublishedPosts()
  const pinned = candidates
    .filter((post) => stickyWeight(post) > 0)
    .sort((left, right) => stickyWeight(right) - stickyWeight(left))

  return pinned[0] ?? candidates[0]
}

export function getPostCalendarParts(dateValue: Date | string) {
  const date = asDate(dateValue)

  // js-yaml parses an unzoned value such as `2026-03-21 19:43:11` as UTC.
  // Treat those UTC fields as the author's Asia/Shanghai wall-clock fields so
  // the route remains identical to the old Hexo permalink.
  return {
    year: String(date.getUTCFullYear()),
    month: twoDigits(date.getUTCMonth() + 1),
    day: twoDigits(date.getUTCDate()),
    hour: twoDigits(date.getUTCHours()),
    minute: twoDigits(date.getUTCMinutes()),
    second: twoDigits(date.getUTCSeconds()),
  }
}

export function getPostSlug(post: PostEntry): string {
  return post.id.split('/').at(-1)?.replace(/\.md$/i, '') ?? post.id
}

export function getPostUrl(post: PostEntry): string {
  const { year, month, day } = getPostCalendarParts(post.data.date)
  return `/${year}/${month}/${day}/${encodeURIComponent(getPostSlug(post))}/`
}

export function getPostCategory(post: PostEntry): string | undefined {
  const categories = post.data.categories
  return Array.isArray(categories) ? categories[0] : categories
}

export function getPostTags(post: PostEntry): string[] {
  return (post.data.tags ?? []).filter(Boolean)
}

export function formatPostDate(dateValue: Date | string): string {
  const { year, month, day } = getPostCalendarParts(dateValue)
  return `${year}-${month}-${day}`
}

export function getPostDateTime(dateValue: Date | string): string {
  const { year, month, day, hour, minute, second } = getPostCalendarParts(dateValue)
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`
}

export function getPostInstant(dateValue: Date | string): Date {
  const date = asDate(dateValue)
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours() - 8,
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  )
}

export function getPostPlainText(post: PostEntry, limit = 12_000): string {
  const text = (post.body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+\.)\s+/gm, '')
    .replace(/[\*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return Array.from(text).slice(0, limit).join('')
}

export function getPostDescription(post: PostEntry, limit = 160): string {
  const description = post.data.description?.trim() || getPostPlainText(post, limit + 1)
  const characters = Array.from(description)
  return characters.length > limit
    ? `${characters.slice(0, limit).join('').trimEnd()}…`
    : description
}
