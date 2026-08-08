// YouTube IFrame Player API の薄いラッパー。
// プレイヤーは1つだけ作って使い回す（お便りごとに iframe を作ると履歴で増え続けるため）。

type Player = {
  loadVideoById: (videoId: string) => void
  playVideo: () => void
  pauseVideo: () => void
  mute: () => void
  unMute: () => void
  destroy: () => void
}

type PlayerEvent = { data: number }

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement, options: unknown) => Player
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiReady: Promise<void> | null = null

function loadApi() {
  if (apiReady) return apiReady

  apiReady = new Promise<void>((resolve) => {
    if (window.YT?.Player) return resolve()
    window.onYouTubeIframeAPIReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(script)
  })

  return apiReady
}

let player: Player | null = null
let playing = false
let onPlayingChange: ((playing: boolean) => void) | null = null

export function subscribe(listener: (playing: boolean) => void) {
  onPlayingChange = listener
}

function setPlaying(next: boolean) {
  playing = next
  onPlayingChange?.(next)
}

export function isPlaying() {
  return playing
}

/** 曲を読み込んで再生する。プレイヤー未生成なら container の中に作る。 */
export async function playVideo(container: HTMLElement, videoId: string) {
  await loadApi()
  if (!window.YT) return

  if (player) {
    player.loadVideoById(videoId)
    player.playVideo()
    return
  }

  player = new window.YT.Player(container, {
    videoId,
    playerVars: {
      // iOS でインライン再生させるために playsinline は必須。
      playsinline: 1,
      autoplay: 1,
      controls: 0,
      rel: 0,
      modestbranding: 1
    },
    events: {
      onReady: (event: { target: Player }) => event.target.playVideo(),
      onStateChange: (event: PlayerEvent) => {
        const state = window.YT?.PlayerState
        if (!state) return
        if (event.data === state.PLAYING) setPlaying(true)
        if (event.data === state.PAUSED || event.data === state.ENDED) setPlaying(false)
      }
    }
  })
}

export function pause() {
  player?.pauseVideo()
}

export function resume() {
  player?.playVideo()
}

export function stop() {
  player?.pauseVideo()
  setPlaying(false)
}
