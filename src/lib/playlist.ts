import fallbackPlaylist from '../data/playlist.json'

export const PLAYLIST_ID = '17846303428'

export interface PlaylistTrack {
  id: number
  title: string
  author: string
  fee: number
  audio: string
}

interface PlaylistDetailResponse {
  playlist?: {
    trackIds?: Array<{ id?: number }>
  }
}

interface SongDetailResponse {
  songs?: Array<{
    id?: number
    name?: string
    fee?: number
    artists?: Array<{ name?: string }>
  }>
}

let playlistPromise: Promise<PlaylistTrack[]> | undefined

const loadPlaylist = async (): Promise<PlaylistTrack[]> => {
  const headers = {
    Accept: 'application/json',
    Referer: 'https://music.163.com/',
    'User-Agent': 'Mozilla/5.0 (compatible; NisconderBlog/1.0)',
  }

  const fetchWithTimeout = async (url: string) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4500)
    try {
      return await fetch(url, { headers, signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
  }

  try {
    const playlistResponse = await fetchWithTimeout(
      `https://music.163.com/api/v6/playlist/detail?id=${PLAYLIST_ID}`,
    )
    if (!playlistResponse.ok) throw new Error(`Playlist HTTP ${playlistResponse.status}`)

    const playlistData = await playlistResponse.json() as PlaylistDetailResponse
    const ids = playlistData.playlist?.trackIds
      ?.map(({ id }) => id)
      .filter((id): id is number => Number.isInteger(id)) ?? []
    if (ids.length === 0) throw new Error('Playlist contains no tracks')

    const songsResponse = await fetchWithTimeout(
      `https://music.163.com/api/song/detail?ids=${encodeURIComponent(JSON.stringify(ids))}`,
    )
    if (!songsResponse.ok) throw new Error(`Songs HTTP ${songsResponse.status}`)

    const songsData = await songsResponse.json() as SongDetailResponse
    const songsById = new Map((songsData.songs ?? []).map((song) => [song.id, song]))
    const tracks = ids.flatMap((id) => {
      const song = songsById.get(id)
      if (!song?.name) return []
      return [{
        id,
        title: song.name,
        author: song.artists?.map(({ name }) => name).filter(Boolean).join(' / ') || '未知音乐人',
        fee: Number.isFinite(song.fee) ? Number(song.fee) : 1,
        audio: `https://music.163.com/song/media/outer/url?id=${id}.mp3`,
      }]
    })

    if (tracks.length !== ids.length) throw new Error('Song details are incomplete')
    return tracks
  } catch {
    return fallbackPlaylist as PlaylistTrack[]
  }
}

export const getPlaylistTracks = () => {
  playlistPromise ??= loadPlaylist()
  return playlistPromise
}
