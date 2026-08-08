import { Agent, callable } from 'agents'
import { resolveTrack, type SpotifyTrack } from '../spotify'

export type RadioEntry = {
  id: string
  postcard: string
  mood: string
  reply: string
  songTitle: string
  songArtist: string
  songReason: string
  spotify: SpotifyTrack | null
  createdAt: number
}

export type RadioState = {
  entries: RadioEntry[]
}

const DJ_NAME = 'DJルナ'

const SYSTEM_PROMPT = `あなたは深夜ラジオのAI DJ「${DJ_NAME}」です。リスナーから届いた「お便り」を読み上げ、それに人格を持って返事をするのがあなたの役目です。

ルール:
- お便りの内容に共感したり、軽くツッコミを入れたりしながら、温かく親しみやすい話し言葉で返事をしてください。
- 返事は3〜4文程度の日本語で、ラジオDJらしい抑揚を感じさせる文章にしてください。
- お便りの気分やシーンを一言で表してください（例: 「疲れた夜」「雨の日の通勤」など）。
- お便りの気分に合いそうな曲を1曲だけ提案してください。提案する曲は必ず「実在する楽曲」にしてください。Spotifyで検索して見つかる、商業リリースされた曲だけを選んでください。架空の曲名やアーティスト名を創作してはいけません。
- 曲名とアーティスト名は、公式表記のとおり正確に書いてください。「(Official Video)」「feat. 〜」のような付随情報や、アルバム名は含めないでください。
- 選曲理由は一文で簡潔に。
- 出力は必ず次のJSON形式のみで返してください。説明文やコードブロックは不要です:
{"mood": "気分・シーン", "reply": "DJとしての返事トーク", "songTitle": "曲名", "songArtist": "アーティスト名", "songReason": "選曲理由"}`

type GeneratedReply = {
  mood: string
  reply: string
  songTitle: string
  songArtist: string
  songReason: string
}

function parseGeneratedReply(raw: string): GeneratedReply {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  return {
    mood: String(parsed.mood ?? ''),
    reply: String(parsed.reply ?? ''),
    songTitle: String(parsed.songTitle ?? ''),
    songArtist: String(parsed.songArtist ?? ''),
    songReason: String(parsed.songReason ?? '')
  }
}

export class RadioAgent extends Agent<CloudflareBindings, RadioState> {
  initialState: RadioState = { entries: [] }

  @callable()
  async submitPostcard(postcard: string) {
    const text = postcard.trim()
    if (!text) throw new Error('お便りが空です')

    const result = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' }
    })

    const raw = typeof result === 'string' ? result : 'response' in result ? (result.response ?? '') : ''
    const generated = parseGeneratedReply(raw)
    const spotify = await resolveTrack(this.env, generated.songTitle, generated.songArtist)

    const entry: RadioEntry = {
      id: crypto.randomUUID(),
      postcard: text,
      ...generated,
      spotify,
      createdAt: Date.now()
    }

    this.setState({ entries: [...this.state.entries, entry] })
    return entry
  }

  @callable()
  async speak(entryId: string) {
    const entry = this.state.entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('お便りが見つかりません')

    const result = await this.env.AI.run('@cf/myshell-ai/melotts', {
      prompt: entry.reply,
      lang: 'ja'
    })

    const audio = result instanceof Uint8Array ? bytesToBase64(result) : result.audio
    return `data:audio/mpeg;base64,${audio}`
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
