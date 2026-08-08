/**
 * 返事の読み上げ。
 * まず Agent 経由で Google Cloud TTS の音声を取りに行き、
 * 鍵が無い・失敗したときだけ端末内蔵の音声に落とす。
 */

let audio: HTMLAudioElement | null = null

function getAudio() {
  if (!audio) audio = new Audio()
  return audio
}

/**
 * iOS Safari は「ユーザー操作の中で呼ばれた play()」しか許さない。
 * 音声を取りに行くのは非同期なので、クリック直後に無音を鳴らして再生権だけ先に取っておく。
 */
export function primeAudio() {
  const element = getAudio()
  if (element.src) return

  const header = new Uint8Array(44)
  const view = new DataView(header.buffer)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36, true)
  write(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  write(36, 'data')
  view.setUint32(40, 0, true)

  element.src = URL.createObjectURL(new Blob([header], { type: 'audio/wav' }))
  element.play().catch(() => {})
}

/**
 * 読み上げを始める。onEnd は成功・失敗どちらでも最後に一度だけ呼ばれる。
 * fetchVoice は音声の data URL（合成できなければ null）を返す。
 */
export async function playReply(
  fetchVoice: () => Promise<string | null>,
  fallbackText: string,
  onEnd: () => void
) {
  stopSpeaking()

  let dataUrl: string | null = null
  try {
    dataUrl = await fetchVoice()
  } catch {
    dataUrl = null
  }

  if (dataUrl) {
    const element = getAudio()
    element.src = dataUrl
    element.onended = onEnd
    element.onerror = onEnd
    try {
      await element.play()
      return
    } catch {
      // 自動再生を弾かれたときは端末の音声で読む。
    }
  }

  speakWithDevice(fallbackText, onEnd)
}

export function stopSpeaking() {
  if (audio) {
    audio.pause()
    audio.onended = null
    audio.onerror = null
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel()
  }
}

// --- 端末内蔵の音声（フォールバック） ---

// 端末には品質の違う日本語ボイスが同居している。名前で当たりを引く。
// 例: iOS の Kyoko(拡張)、Android/Chrome の Google 日本語、Windows の Nanami(Natural)。
const PREFERRED = [/natural|neural|premium|enhanced/i, /google/i, /kyoko|o-ren|otoya|nanami|ayumi/i]

let cachedVoice: SpeechSynthesisVoice | null = null

function resolveVoice() {
  const japanese = window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'))
  if (japanese.length === 0) return cachedVoice

  const score = (voice: SpeechSynthesisVoice) => {
    const hit = PREFERRED.findIndex((pattern) => pattern.test(voice.name))
    // ネットワーク側のボイスは端末内蔵より新しく、たいてい自然に聞こえる。
    return (hit === -1 ? PREFERRED.length : hit) * 2 + (voice.localService ? 1 : 0)
  }

  cachedVoice = [...japanese].sort((a, b) => score(a) - score(b))[0]
  return cachedVoice
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  // getVoices() は初回に空配列を返すことがあるので、揃った時点で取り直す。
  resolveVoice()
  window.speechSynthesis.addEventListener('voiceschanged', resolveVoice)
}

function speakWithDevice(text: string, onEnd: () => void) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onEnd()
    return
  }

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ja-JP'
  utterance.rate = 1.05
  utterance.pitch = 1.05
  const voice = resolveVoice()
  if (voice) utterance.voice = voice
  utterance.onend = onEnd
  utterance.onerror = onEnd

  window.speechSynthesis.speak(utterance)
}
