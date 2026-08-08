// Spotify Web API クライアント（Client Credentials フロー）。
// ユーザーログイン不要でトラック検索だけを行う。フル尺再生は Web Playback SDK 側の担当。

export type SpotifyTrack = {
  id: string
  name: string
  artist: string
  url: string
  uri: string
  albumImage: string | null
}

type TokenResponse = {
  access_token: string
  expires_in: number
}

type SearchResponse = {
  tracks?: {
    items?: {
      id: string
      name: string
      uri: string
      external_urls?: { spotify?: string }
      artists?: { name: string }[]
      album?: { images?: { url: string; width: number }[] }
    }[]
  }
}

// アクセストークンは isolate 内で使い回す（有効期限は通常1時間）。
let cachedToken: { value: string; expiresAt: number } | null = null

async function getAppToken(env: CloudflareBindings): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.value
  }

  const credentials = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' })
  })

  if (!res.ok) {
    cachedToken = null
    throw new Error(`Spotify token request failed: ${res.status}`)
  }

  const data = (await res.json()) as TokenResponse
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in * 1000 }
  return cachedToken.value
}

// 検索クエリ内の " は field filter を壊すので落とす。
function sanitize(value: string) {
  return value.replace(/["]/g, ' ').trim()
}

async function search(token: string, query: string): Promise<SpotifyTrack | null> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: '1', market: 'JP' })
  const res = await fetch(`https://api.spotify.com/v1/search?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok) {
    throw new Error(`Spotify search failed: ${res.status}`)
  }

  const data = (await res.json()) as SearchResponse
  const item = data.tracks?.items?.[0]
  if (!item) return null

  const images = item.album?.images ?? []
  // images は大きい順に並ぶため、末尾寄りの中サイズを優先する。
  const albumImage = images.at(1)?.url ?? images.at(0)?.url ?? null

  return {
    id: item.id,
    name: item.name,
    artist: (item.artists ?? []).map((a) => a.name).join(', '),
    url: item.external_urls?.spotify ?? `https://open.spotify.com/track/${item.id}`,
    uri: item.uri,
    albumImage
  }
}

/**
 * DJ が挙げた曲名・アーティスト名を実在の Spotify トラックに解決する。
 * 解決できなくてもお便り自体は成立させたいので、失敗時は例外を投げず null を返す。
 */
export async function resolveTrack(
  env: CloudflareBindings,
  title: string,
  artist: string
): Promise<SpotifyTrack | null> {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    console.warn('Spotify credentials are not configured; skipping track resolution')
    return null
  }

  const cleanTitle = sanitize(title)
  const cleanArtist = sanitize(artist)
  if (!cleanTitle) return null

  // 厳密な field filter で狙い撃ちし、外したらフリーワードで拾い直す。
  const queries = cleanArtist
    ? [`track:"${cleanTitle}" artist:"${cleanArtist}"`, `${cleanTitle} ${cleanArtist}`]
    : [`track:"${cleanTitle}"`, cleanTitle]

  try {
    const token = await getAppToken(env)
    for (const query of queries) {
      const track = await search(token, query)
      if (track) return track
    }
    return null
  } catch (e) {
    console.error('Spotify track resolution failed', e)
    return null
  }
}
