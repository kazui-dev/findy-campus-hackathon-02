import { useRef, useState } from 'react'
import { useAgent } from 'agents/react'
import type { RadioAgent, RadioState, RadioEntry } from '../agents/radio'

export function RadioDJ() {
  const [entries, setEntries] = useState<RadioEntry[]>([])
  const [postcard, setPostcard] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const agent = useAgent<RadioAgent, RadioState>({
    agent: 'RadioAgent',
    name: 'main',
    onStateUpdate: (state) => setEntries(state.entries)
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = postcard.trim()
    if (!text || submitting) return

    setSubmitting(true)
    setError(null)
    try {
      await agent.stub.submitPostcard(text)
      setPostcard('')
    } catch {
      setError('お便りの送信に失敗しました。もう一度お試しください。')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSpeak(entry: RadioEntry) {
    setSpeakingId(entry.id)
    setError(null)
    try {
      const dataUrl = await agent.stub.speak(entry.id)
      if (audioRef.current) {
        audioRef.current.src = dataUrl
        await audioRef.current.play()
      }
    } catch {
      setError('音声の再生に失敗しました。')
    } finally {
      setSpeakingId(null)
    }
  }

  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="radio">
      <header className="radio-header">
        <h1>📻 お便りラジオ</h1>
        <p>AI DJルナに、いまの気分やお願いごとを送ってみよう。</p>
      </header>

      <form className="postcard-form" onSubmit={handleSubmit}>
        <textarea
          value={postcard}
          onChange={(e) => setPostcard(e.target.value)}
          placeholder="例: 最近仕事が忙しくて疲れてます。元気が出る曲を！"
          rows={3}
          disabled={submitting}
        />
        <button type="submit" disabled={submitting || !postcard.trim()}>
          {submitting ? '送信中…' : 'お便りを送る'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <audio ref={audioRef} />

      <ul className="entries">
        {sorted.length === 0 && <p className="empty">まだお便りが届いていません。最初のお便りを送ってみよう。</p>}
        {sorted.map((entry) => (
          <li key={entry.id} className="entry">
            <div className="postcard">
              <span className="label">お便り</span>
              <p>{entry.postcard}</p>
            </div>
            <div className="reply">
              <span className="label">DJルナ{entry.mood && ` ・ ${entry.mood}`}</span>
              <p>{entry.reply}</p>
              <button type="button" onClick={() => handleSpeak(entry)} disabled={speakingId === entry.id}>
                {speakingId === entry.id ? '再生準備中…' : '🔊 声で聴く'}
              </button>
            </div>
            <div className="song">
              <span className="label">今日の一曲</span>
              {entry.spotify ? (
                <a className="track" href={entry.spotify.url} target="_blank" rel="noreferrer">
                  {entry.spotify.albumImage && (
                    <img className="track-art" src={entry.spotify.albumImage} alt="" width={64} height={64} />
                  )}
                  <span className="track-meta">
                    <strong>{entry.spotify.name}</strong>
                    <span className="track-artist">{entry.spotify.artist}</span>
                    <span className="track-open">Spotifyで開く ↗</span>
                  </span>
                </a>
              ) : (
                <p className="song-title">
                  <strong>{entry.songTitle}</strong> / {entry.songArtist}
                </p>
              )}
              <p className="reason">{entry.songReason}</p>
              {!entry.spotify && <p className="spotify-note">🎧 Spotifyでこの曲は見つかりませんでした</p>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
