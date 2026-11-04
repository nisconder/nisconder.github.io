/**
 * Resolve author-defined reading lists without changing either input collection.
 * References are checked against all posts, then drafts are hidden from readers.
 *
 * @template {{ id: string, data: { title: string, draft?: boolean, chapters: { post: string }[] } }} S
 * @template {{ id: string, data: { draft?: boolean } }} P
 * @param {readonly S[]} entries
 * @param {readonly P[]} posts
 * @returns {{ id: string, data: S['data'], posts: P[], href: string }[]}
 */
export function resolvePublishedSeries(entries, posts) {
  const postsById = new Map(posts.map((post) => [post.id, post]))
  const seenSeriesIds = new Set()

  return entries.map((series) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(series.id)) {
      throw new Error(`合集「${series.data.title}」的文件名无效：${series.id}。请使用小写英文字母、数字和连字符。`)
    }
    if (seenSeriesIds.has(series.id)) {
      throw new Error(`合集 ID 重复：${series.id}`)
    }
    seenSeriesIds.add(series.id)

    const seenPosts = new Set()
    const orderedPosts = series.data.chapters.map(({ post: postId }) => {
      if (seenPosts.has(postId)) {
        throw new Error(`合集「${series.data.title}」重复收录了文章：${postId}`)
      }
      seenPosts.add(postId)
      const post = postsById.get(postId)
      if (!post) {
        throw new Error(`合集「${series.data.title}」引用的文章不存在：${postId}。请填写 source/_posts 中的文件名（不含 .md）。`)
      }
      return post
    })

    return {
      id: series.id,
      data: series.data,
      posts: orderedPosts.filter((post) => post.data.draft !== true),
      href: `/series/${series.id}/`,
    }
  }).filter((series) => series.data.draft !== true && series.posts.length > 0)
    .sort((left, right) =>
      left.data.title.localeCompare(right.data.title, 'zh-CN')
      || left.id.localeCompare(right.id, 'en'),
    )
}
