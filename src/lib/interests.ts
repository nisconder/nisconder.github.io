import { featuredSoftware, softwareStatusLabels } from '../data/software'
import { getPlaylistTracks, isPlayableTrack } from './playlist'
import {
  getPostCategory,
  getPostReadingMinutes,
  getPostSlug,
  getPostTags,
  getPostUrl,
  getPublishedPosts,
  type PostEntry,
} from './posts'

export interface InterestPoint {
  section: string
  relation: string
  title: string
  description: string
  href: string
  external?: boolean
}

export type InterestSection = 'articles' | 'article' | 'software' | 'music' | 'about' | 'search'

const shorten = (value: string, limit = 58) => {
  const characters = Array.from(value.trim())
  return characters.length > limit
    ? `${characters.slice(0, limit).join('').trimEnd()}…`
    : characters.join('')
}

const uniquePoints = (items: Array<InterestPoint | undefined>) => {
  const seen = new Set<string>()
  return items.flatMap((item) => {
    if (!item || seen.has(item.href)) return []
    seen.add(item.href)
    return [item]
  }).slice(0, 2)
}

let catalogPromise: Promise<{
  latestArticle?: InterestPoint
  articleIndex: InterestPoint
  project: InterestPoint
  music?: InterestPoint
  about: InterestPoint
}> | undefined

const getInterestCatalog = () => {
  catalogPromise ??= Promise.all([getPublishedPosts(), getPlaylistTracks()]).then(([posts, playlist]) => {
    const latestPost = posts[0]
    const firstPlayable = playlist.find(isPlayableTrack) ?? playlist[0]
    const musicPoint = firstPlayable
      ? {
          section: '音乐',
          relation: '换到最近在听的内容',
          title: firstPlayable.title,
          description: `${firstPlayable.author} · ${isPlayableTrack(firstPlayable) ? '可以在站内试听' : '从歌单页继续'}`,
          href: '/music/',
        }
      : undefined

    return {
      latestArticle: latestPost
          ? {
            section: '文章',
            relation: '从最近发布的内容开始',
            title: latestPost.data.title,
            description: `${getPostCategory(latestPost) ?? '文章'} · 约 ${getPostReadingMinutes(latestPost)} 分钟`,
            href: getPostUrl(latestPost),
          }
        : undefined,
      articleIndex: {
        section: '文章索引',
        relation: '回到完整索引',
        title: '按主题或年份继续找',
        description: `${posts.length} 篇公开文章，保留完整分类、主题与年份入口。`,
        href: '/articles/',
      },
      project: {
        section: '项目',
        relation: '看正在维护的东西',
        title: featuredSoftware.name,
        description: `${softwareStatusLabels[featuredSoftware.status]} · ${shorten(featuredSoftware.summary)}`,
        href: `/software/#${featuredSoftware.slug}`,
      },
      music: musicPoint,
      about: {
        section: '关于',
        relation: '看看这些内容从哪里来',
        title: '关于 Nisconder',
        description: '代码、阅读、音乐与生活记录为什么会放在同一个站里。',
        href: '/about/',
      },
    }
  })

  return catalogPromise
}

export async function getInterestJourney(section: InterestSection, post?: PostEntry) {
  const catalog = await getInterestCatalog()
  const relate = (item: InterestPoint | undefined, relation: string) => (
    item ? { ...item, relation } : undefined
  )

  if (section === 'articles') {
    return uniquePoints([
      relate(catalog.latestArticle, '从最新一篇进入正文'),
      relate(catalog.project, '离开归档，看看正在做什么'),
    ])
  }

  if (section === 'article') {
    const slug = post ? getPostSlug(post) : ''
    const technical = post
      ? getPostCategory(post) === '技术'
        || [post.data.title, ...getPostTags(post)].join(' ').match(/npm|代码|开发|技术/i)
      : false

    if (slug === '2026-03-21-blog1') {
      return uniquePoints([
        {
          ...catalog.about,
          href: '/about/#writing',
          relation: '继续看写作背后的关注',
          title: '我在记录什么',
          description: '技术之外，也记录社会、文化和生活观察。',
        },
        relate(catalog.music, '读完以后换一种节奏'),
      ])
    }

    return technical
      ? uniquePoints([
          relate(catalog.project, '这篇复盘对应的工具'),
          relate(catalog.music ?? catalog.about, '读完以后换一种节奏'),
        ])
      : uniquePoints([
          relate(catalog.about, '继续看这些文字背后的关注'),
          relate(catalog.music, '换到最近在听的内容'),
        ])
  }

  if (section === 'software') {
    return uniquePoints([
      relate(catalog.music ?? catalog.about, '看完项目，换到最近在听的内容'),
      relate(catalog.latestArticle ?? catalog.articleIndex, '回到项目背后的开发复盘'),
    ])
  }

  if (section === 'music') {
    return uniquePoints([
      relate(catalog.about, '听完以后，看看这些收藏属于谁'),
      relate(catalog.latestArticle ?? catalog.articleIndex, '从音乐回到一篇文字'),
    ])
  }

  if (section === 'about') {
    return uniquePoints([
      relate(catalog.latestArticle ?? catalog.articleIndex, '从作者介绍进入一篇代表内容'),
      relate(catalog.project, '再看看持续维护的项目'),
    ])
  }

  return uniquePoints([
    relate(catalog.articleIndex, '没有目标时，从完整文章索引继续'),
    relate(catalog.project, '也可以直接看一个正在维护的项目'),
  ])
}
