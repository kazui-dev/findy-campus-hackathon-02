import { Agent, callable } from 'agents'
import { synthesizeBase64 } from '../tts'
import { resolveVideo, type YouTubeVideo } from '../youtube'

export type OtayoriEntry = {
  id: string
  postcard: string
  reply: string
  songTitle: string
  songArtist: string
  youtube: YouTubeVideo | null
  createdAt: number
}

export type OtayoriState = {
  entries: OtayoriEntry[]
}

// 語り手に名前や肩書きは与えない。返事は「誰か」ではなく、お便りそのものに向き合う。
// 返事はそのまま声になるので、受け止めから曲紹介までを一続きの話し言葉で書かせる。
const SYSTEM_PROMPT = `あなたは、届いた「お便り」を受け止めて返事をする存在です。返事はそのまま声に出して読まれます。

ルール:
- 名乗らないでください。自分の名前・肩書き・キャラクター設定には一切触れないでください。
- 返事は3〜4文の日本語。落ち着いた話し言葉で、そのまま読み上げられる文章にしてください。
- まず相手の気持ちを受け止めてください。説教はしない。安易に励まさない。
- 受け止めたあと、同じ返事の中で曲を1曲紹介してください。曲名とアーティスト名を必ず言い切り、なぜその曲なのかも一言添えてください。「〜の」のような言いさしで終わらせてはいけません。
  例: 「…そんな夜には、この曲を。○○(アーティスト名)で、○○(曲名)。まっすぐな言葉が、少しだけ肩の力を抜いてくれます。」
- 紹介する曲は必ず「実在する楽曲」にしてください。YouTubeで検索して見つかる、商業リリースされた曲だけを選んでください。架空の曲名やアーティスト名を創作してはいけません。
- 日本で知名度の高い曲を選んでください。日本のヒット曲か、日本でも広く聴かれている洋楽から選ぶこと。多くの人が「知っている」と感じる曲が正解です。マニアックな曲、知る人ぞ知る曲は避けてください。
- 返事の中で曲名やアーティスト名を言うときは、耳で聞いて自然な表記にしてください（例:「○○で、○○」）。
- songTitle と songArtist は検索に使います。公式表記のとおり正確に、「(Official Video)」「feat. 〜」のような付随情報やアルバム名は含めずに書いてください。
- 出力は必ず次のJSON形式のみで返してください。説明文やコードブロックは不要です:
{"reply": "返事", "songTitle": "曲名", "songArtist": "アーティスト名"}`

type GeneratedReply = {
  reply: string
  songTitle: string
  songArtist: string
}

function parseGeneratedReply(raw: string): GeneratedReply {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
  return {
    reply: String(parsed.reply ?? ''),
    songTitle: String(parsed.songTitle ?? ''),
    songArtist: String(parsed.songArtist ?? '')
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
      response_format: { type: 'json_object' },
      // 既定(256)だと日本語では曲紹介の途中で切れる。
      max_tokens: 768
    })

    const raw = typeof result === 'string' ? result : 'response' in result ? (result.response ?? '') : ''
    const generated = parseGeneratedReply(raw)

    // 曲探しと読み上げは互いに独立しているので同時に走らせる。
    // 音声は返事と一緒に返し、クライアントが往復なしですぐ鳴らせるようにする。
    const [youtube, audio] = await Promise.all([
      resolveVideo(this.env, generated.songTitle, generated.songArtist),
      synthesizeBase64(this.env, generated.reply)
    ])

    const entry: OtayoriEntry = {
      id: crypto.randomUUID(),
      postcard: text,
      ...generated,
      youtube,
      createdAt: Date.now()
    }

    this.setState({ entries: [...this.state.entries, entry] })
    // 音声は state に残さない（base64がお便りの数だけ積み上がるため）。
    return { entry, audio: audio ? `data:audio/mpeg;base64,${audio}` : null }
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
