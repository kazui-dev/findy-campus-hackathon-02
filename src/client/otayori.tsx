import { useEffect, useState } from 'react'
import { useAgent } from 'agents/react'
import type { OtayoriAgent, OtayoriState, OtayoriEntry } from '../agents/otayori'
import { getClientId } from './client-id'
import { playReply, primeAudio, stopSpeaking } from './speech'

type Tab = 'write' | 'history'

export function Otayori() {
  const [tab, setTab] = useState<Tab>('write')
  const [entries, setEntries] = useState<OtayoriEntry[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [latest, setLatest] = useState<OtayoriEntry | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [clientId] = useState(getClientId)

  // 読み上げは画面を離れても鳴り続けるので、アンマウント時に必ず止める。
  useEffect(() => stopSpeaking, [])

  const agent = useAgent<OtayoriAgent, OtayoriState>({
    agent: 'OtayoriAgent',
    name: clientId,
    onStateUpdate: (state) => setEntries(state.entries)
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value || sending) return

    setSending(true)
    setError(null)
    try {
      const entry = await agent.stub.submitPostcard(value)
      setText('')
      setLatest(entry)
    } catch {
      setError('うまく送れませんでした。もう一度お試しください。')
    } finally {
      setSending(false)
    }
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
    setSpeakingId(entry.id)
    playReply(
      () => agent.stub.speak(entry.id),
      entry.reply,
      () => setSpeakingId((current) => (current === entry.id ? null : current))
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
              <ReplyCard entry={latest} speaking={speakingId === latest.id} onSpeak={handleSpeak} />
              <button type="button" className="ghost-button" onClick={() => setLatest(null)}>
                また書く
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
                  <ReplyCard entry={entry} speaking={speakingId === entry.id} onSpeak={handleSpeak} />
                </article>
              ))
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </main>

      <nav className="tabbar">
        <button type="button" className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>
          書く
        </button>
        <button type="button" className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          これまで
        </button>
      </nav>
    </div>
  )
}

function ReplyCard({
  entry,
  speaking,
  onSpeak
}: {
  entry: OtayoriEntry
  speaking: boolean
  onSpeak: (entry: OtayoriEntry) => void
}) {
  return (
    <div className="reply">
      <p className="reply-text">{entry.reply}</p>
      <button type="button" className={speaking ? 'speak-button speaking' : 'speak-button'} onClick={() => onSpeak(entry)}>
        {speaking ? 'とめる' : '聴く'}
      </button>

      {entry.spotify ? (
        <a className="track" href={entry.spotify.url} target="_blank" rel="noreferrer">
          {entry.spotify.albumImage && <img className="track-art" src={entry.spotify.albumImage} alt="" width={48} height={48} />}
          <span className="track-meta">
            <span className="track-name">{entry.spotify.name}</span>
            <span className="track-artist">{entry.spotify.artist}</span>
          </span>
        </a>
      ) : (
        <p className="track track-plain">
          <span className="track-meta">
            <span className="track-name">{entry.songTitle}</span>
            <span className="track-artist">{entry.songArtist}</span>
          </span>
        </p>
      )}
      <p className="track-reason">{entry.songReason}</p>
    </div>
  )
}

const dateFormatter = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' })

function formatDate(timestamp: number) {
  return dateFormatter.format(new Date(timestamp))
}
