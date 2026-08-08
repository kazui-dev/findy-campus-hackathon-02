import { useEffect, useRef, useState } from 'react'
import { useAgent } from 'agents/react'
import type { OtayoriAgent, OtayoriState, OtayoriEntry } from '../agents/otayori'
import { getClientId } from './client-id'
import { playReply, primeAudio, stopSpeaking } from './speech'
import { pause, playVideo, resume, stop, subscribe } from './youtube-player'

type Tab = 'write' | 'history'

export function Otayori() {
  const [tab, setTab] = useState<Tab>('write')
  const [entries, setEntries] = useState<OtayoriEntry[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [latest, setLatest] = useState<OtayoriEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [nowPlaying, setNowPlaying] = useState<OtayoriEntry | null>(null)
  const [playing, setPlaying] = useState(false)
  const [clientId] = useState(getClientId)
  const playerHost = useRef<HTMLDivElement>(null)

  useEffect(() => {
    subscribe(setPlaying)
    // 読み上げも曲も画面を離れると鳴りっぱなしになるので、必ず止める。
    return () => {
      stopSpeaking()
      stop()
    }
  }, [])

  const agent = useAgent<OtayoriAgent, OtayoriState>({
    agent: 'OtayoriAgent',
    name: clientId,
    onStateUpdate: (state) => setEntries(state.entries)
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value || sending) return

    // 返事が返るまで数秒あくので、タップの権利があるいまのうちに再生を許可させる。
    primeAudio()
    stop()
    setSending(true)
    setError(null)
    try {
      const { entry, audio } = await agent.stub.submitPostcard(value)
      setText('')
      setLatest(entry)
      // 届いたらそのまま読み上げ、読み終わったら曲へ。タップは挟まない。
      setSpeakingId(entry.id)
      playReply(
        () => Promise.resolve(audio),
        entry.reply,
        () => {
          setSpeakingId((current) => (current === entry.id ? null : current))
          startSong(entry)
        }
      )
    } catch {
      setError('うまく送れませんでした。もう一度お試しください。')
    } finally {
      setSending(false)
    }
  }

  function startSong(entry: OtayoriEntry) {
    if (!entry.youtube || !playerHost.current) return
    setNowPlaying(entry)
    playVideo(playerHost.current, entry.youtube.videoId)
  }

  function handleSpeak(entry: OtayoriEntry) {
    setError(null)

    if (speakingId === entry.id) {
      stopSpeaking()
      setSpeakingId(null)
      return
    }

    // 音声を取りに行く前に、クリックの権利があるうちに再生を許可させる。
    primeAudio()
    stop()
    setSpeakingId(entry.id)
    playReply(
      () => agent.stub.speak(entry.id),
      entry.reply,
      () => {
        setSpeakingId((current) => (current === entry.id ? null : current))
        // 返事を読み終えたら、そのまま曲へ渡す。
        startSong(entry)
      }
    )
  }

  const history = [...entries].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="app">
      <header className="app-header">otayori</header>

      <main className="app-main">
        {tab === 'write' ? (
          latest ? (
            <div className="reply-view">
              <ReplyCard
                entry={latest}
                speaking={speakingId === latest.id}
                auto
                onSpeak={handleSpeak}
                onPlaySong={startSong}
              />
              <button type="button" className="ghost-button" onClick={() => setLatest(null)}>
                別のおたよりを書く
              </button>
            </div>
          ) : (
            <form className="compose" onSubmit={handleSubmit}>
              <textarea
                className="compose-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="いま思っていることを、そのまま。"
                disabled={sending}
                autoFocus
              />
              <button type="submit" className="primary-button" disabled={sending || !text.trim()}>
                {sending ? '送っています' : '送る'}
              </button>
            </form>
          )
        ) : (
          <div className="history">
            {history.length === 0 ? (
              <p className="empty">まだ何も書いていません。</p>
            ) : (
              history.map((entry) => (
                <article key={entry.id} className="history-item">
                  <time className="history-date">{formatDate(entry.createdAt)}</time>
                  <p className="history-postcard">{entry.postcard}</p>
                  <ReplyCard
                    entry={entry}
                    speaking={speakingId === entry.id}
                    onSpeak={handleSpeak}
                    onPlaySong={startSong}
                  />
                </article>
              ))
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </main>

      {/* プレイヤーは作り直すと再生が切れるので、常に置いたまま表示だけ切り替える。 */}
      <div className={nowPlaying ? 'miniplayer' : 'miniplayer is-idle'}>
        <div className="miniplayer-video">
          <div ref={playerHost} />
        </div>
        <div className="miniplayer-meta">
          <span className="miniplayer-title">{nowPlaying?.youtube?.title}</span>
          <span className="miniplayer-channel">{nowPlaying?.youtube?.channel}</span>
        </div>
        <button
          type="button"
          className="miniplayer-toggle"
          onClick={() => (playing ? pause() : resume())}
          aria-label={playing ? '一時停止' : '再生'}
        >
          {playing ? '❙❙' : '▶'}
        </button>
      </div>

      <nav className="tabbar">
        <button type="button" className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>
          おたよりを書く
        </button>
        <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          履歴
        </button>
      </nav>
    </div>
  )
}

function ReplyCard({
  entry,
  speaking,
  auto = false,
  onSpeak,
  onPlaySong
}: {
  entry: OtayoriEntry
  speaking: boolean
  auto?: boolean
  onSpeak: (entry: OtayoriEntry) => void
  onPlaySong: (entry: OtayoriEntry) => void
}) {
  // 届いた直後は勝手に読み上げているので、出すのは「とめる」だけでいい。
  const showSpeakButton = speaking || !auto

  return (
    <div className="reply">
      <p className="reply-text">{entry.reply}</p>
      {showSpeakButton && (
        <button type="button" className={speaking ? 'speak-button speaking' : 'speak-button'} onClick={() => onSpeak(entry)}>
          {speaking ? 'とめる' : '聴く'}
        </button>
      )}

      {entry.youtube ? (
        <button type="button" className="track" onClick={() => onPlaySong(entry)}>
          <span className="track-play" aria-hidden="true">
            ▶
          </span>
          <span className="track-meta">
            <span className="track-name">{entry.songTitle}</span>
            <span className="track-artist">{entry.songArtist}</span>
          </span>
        </button>
      ) : (
        <p className="track track-plain">
          <span className="track-meta">
            <span className="track-name">{entry.songTitle}</span>
            <span className="track-artist">{entry.songArtist}</span>
          </span>
        </p>
      )}
    </div>
  )
}

const dateFormatter = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' })

function formatDate(timestamp: number) {
  return dateFormatter.format(new Date(timestamp))
}
