import type { APIRoute, GetStaticPaths } from 'astro'
import { getSearchIndexData } from '../../lib/search-index'

export const prerender = true
export const getStaticPaths = (async () => {
  const { version, json } = await getSearchIndexData()
  return [{ params: { version }, props: { json } }]
}) satisfies GetStaticPaths

export const GET: APIRoute = ({ props }) => new Response(props.json, {
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
  },
})
