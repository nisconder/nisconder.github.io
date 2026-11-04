import type { APIRoute } from 'astro'
import { getSearchIndexData } from '../lib/search-index'

export const prerender = true

// Keep the original full-text array endpoint for existing clients and checks.
export const GET: APIRoute = async () => new Response((await getSearchIndexData()).json, {
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=0, must-revalidate',
  },
})
