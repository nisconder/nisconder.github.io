// These entries were published before the host migration. Keep their exact
// identities so existing feed readers do not receive them as new articles.
const legacyFeedGuids: Readonly<Record<string, string>> = {
  '2026-03-21-blog1': 'https://nisconder-blog.netlify.app/2026/03/21/2026-03-21-blog1/',
  '2026-08-26-blog1': 'https://nisconder-blog.netlify.app/2026/08/26/2026-08-26-blog1/',
}

export function getFeedIdentity(postId: string) {
  const legacyGuid = legacyFeedGuids[postId]
  return legacyGuid
    ? { guid: legacyGuid, isPermaLink: true }
    : { guid: `urn:nisconder:post:${encodeURIComponent(postId)}`, isPermaLink: false }
}
