import { Agent, callable } from 'agents'
import { resolveTrack, type SpotifyTrack } from '../spotify'
import { synthesizeBase64 } from '../tts'

export type OtayoriEntry = {
  id: string
  postcard: string
  reply: string
  songTitle: string
  songArtist: string
  songReason: string
  spotify: SpotifyTrack | null
  createdAt: number
}

export type OtayoriState = {
  entries: OtayoriEntry[]
}

// 語り手に名前や肩書きは与えない。返事は「誰か」ではなく、お便りそのものに向き合う。
const SYSTEM_PROMPT = `あなたは、届いた「お便り」を静かに受け止めて返事を書く存在です。

ルール:
- 名乗らないでください。自分の名前・肩書き・キャラクター設定には一切触れないでください。
- 返事は2〜3文の日本語。相手の気持ちをそのまま受け止める、落ち着いた話し言葉で。
- 助言や説教はしない。安易に励まさない。まず受け止めることを優先してください。
- お便りの気分に合いそうな曲を1曲だけ提案してください。提案する曲は必ず「実在する楽曲」にしてください。Spotifyで検索して見つかる、商業リリースされた曲だけを選んでください。架空の曲名やアーティスト名を創作してはいけません。
- 曲名とアーティスト名は、公式表記のとおり正確に書いてください。「(Official Video)」「feat. 〜」のような付随情報や、アルバム名は含めないでください。
- 選曲理由は一文で簡潔に。
- 出力は必ず次のJSON形式のみで返してください。説明文やコードブロックは不要です:
{"reply": "返事", "songTitle": "曲名", "songArtist": "アーティスト名", "songReason": "選曲理由"}`

type GeneratedReply = {
  reply: string
  songTitle: string
  songArtist: string
  songReason: string
}

function parseGeneratedReply(raw: string): GeneratedReply {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  return {
    reply: String(parsed.reply ?? ''),
    songTitle: String(parsed.songTitle ?? ''),
    songArtist: String(parsed.songArtist ?? ''),
    songReason: String(parsed.songReason ?? '')
  }
}

/**
 * お便り1件ぶんの往復を保持する Agent。
 * インスタンス名にはクライアント側で発行した ID を使うので、状態は書いた本人だけのものになる。
 */
export class OtayoriAgent extends Agent<CloudflareBindings, OtayoriState> {
  initialState: OtayoriState = { entries: [] }

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

    const entry: OtayoriEntry = {
      id: crypto.randomUUID(),
      postcard: text,
      ...generated,
      spotify,
      createdAt: Date.now()
    }

    this.setState({ entries: [...this.state.entries, entry] })
    return entry
  }

  /**
   * 読み上げ音声を返す。合成できるのは「この人の状態に入っている返事」だけ。
   * 任意のテキストは受け取らないので、TTSの枠を外から使い減らされることがない。
   * 認証情報が無い/失敗したときは null を返し、クライアントは端末の音声に切り替える。
   */
  @callable()
  async speak(entryId: string) {
    const entry = this.state.entries.find((e) => e.id === entryId)
    if (!entry) throw new Error('お便りが見つかりません')

    const audio = await synthesizeBase64(this.env, entry.reply)
    return audio ? `data:audio/mpeg;base64,${audio}` : null
  }
}
