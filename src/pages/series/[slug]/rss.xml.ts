import type { APIRoute, GetStaticPaths } from 'astro'
import { getPublishedSeries, type BlogSeries } from '../../../lib/series'
import { renderRssFeed } from '../../../lib/rss'

interface Props { series: BlogSeries }

export const prerender = true
export const getStaticPaths = (async () => (await getPublishedSeries()).map(series => ({
  params: { slug: series.id },
  props: { series },
}))) satisfies GetStaticPaths

export const GET: APIRoute = ({ props, site, url }) => {
  const { series } = props as Props
  return new Response(renderRssFeed({
    posts: series.posts,
    base: site ?? url.origin,
    title: `${series.data.title} — Nisconder`,
    description: series.data.description,
    linkPath: series.href,
    feedPath: `${series.href}rss.xml`,
  }), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
