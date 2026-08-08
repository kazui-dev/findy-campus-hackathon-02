// YouTube Data API v3。曲名とアーティスト名から、埋め込み再生できる動画を1本だけ引く。
// search.list は 1回 100 ユニット（既定の1日枠 10,000 = 約100回）なので、お便り1件につき1回に留める。

export type YouTubeVideo = {
  videoId: string
  title: string
  channel: string
}

type SearchResponse = {
  items?: {
    id?: { videoId?: string }
    snippet?: { title?: string; channelTitle?: string }
  }[]
}

// snippet のテキストは HTML エスケープされて返る（&amp; &#39; など）。
function decodeEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/**
 * 曲を YouTube の動画に解決する。
 * 見つからなくてもお便り自体は成立させたいので、失敗時は例外を投げず null を返す。
 */
export async function resolveVideo(
  env: CloudflareBindings,
  title: string,
  artist: string
): Promise<YouTubeVideo | null> {
  if (!env.YOUTUBE_API_KEY) {
    console.warn('YOUTUBE_API_KEY is not configured; skipping video resolution')
    return null
  }

  const query = [title, artist].filter(Boolean).join(' ').trim()
  if (!query) return null

  const params = new URLSearchParams({
    key: env.YOUTUBE_API_KEY,
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: '1',
    // 埋め込み不可・配信停止の動画を引くと再生できないので、検索の時点で除外する。
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    regionCode: 'JP',
    relevanceLanguage: 'ja'
  })

  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
    if (!res.ok) {
      console.error(`YouTube search failed: ${res.status} ${await res.text()}`)
      return null
    }

    const data = (await res.json()) as SearchResponse
    const item = data.items?.[0]
    const videoId = item?.id?.videoId
    if (!videoId) return null

    return {
      videoId,
      title: decodeEntities(item?.snippet?.title ?? title),
      channel: decodeEntities(item?.snippet?.channelTitle ?? artist)
    }
  } catch (e) {
    console.error('YouTube search failed', e)
    return null
  }
}
