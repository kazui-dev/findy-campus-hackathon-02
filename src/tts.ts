// Google Cloud Text-to-Speech クライアント。
// 認証は2通りに対応する:
//   1. GOOGLE_TTS_API_KEY … APIキー1本。設定が一番かんたん。
//   2. GOOGLE_SERVICE_ACCOUNT_JSON … サービスアカウント。JWTを署名してアクセストークンに交換する。
// どちらも無ければ null を返し、クライアント側は端末内蔵の音声にフォールバックする。

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

// Chirp 3: HD が現行で最も自然な日本語ボイス。名前は星の名前（Achernar は女性声）。
const DEFAULT_VOICE = 'ja-JP-Chirp3-HD-Achernar'
// Chirp 3 を受け付けないプロジェクト向けの控え。
const FALLBACK_VOICE = 'ja-JP-Neural2-B'

type ServiceAccount = {
  client_email: string
  private_key: string
}

type SynthesizeResponse = {
  audioContent?: string
}

let cachedToken: { value: string; expiresAt: number } | null = null

function base64url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i++) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function pemToPkcs8(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** サービスアカウントの秘密鍵でJWTを署名し、アクセストークンに交換する。 */
async function getAccessToken(raw: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedToken.expiresAt > now + 60) return cachedToken.value

  const account = JSON.parse(raw) as ServiceAccount
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: account.client_email,
        scope: SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600
      })
    )
  )

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claims}`)
  )
  const assertion = `${header}.${claims}.${base64url(signature)}`

  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })

  if (!res.ok) {
    cachedToken = null
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { value: data.access_token, expiresAt: now + data.expires_in }
  return cachedToken.value
}

async function requestSynthesis(env: CloudflareBindings, text: string, voice: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }

  if (env.GOOGLE_TTS_API_KEY) {
    headers['X-Goog-Api-Key'] = env.GOOGLE_TTS_API_KEY
  } else {
    headers.Authorization = `Bearer ${await getAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON)}`
  }

  return fetch(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'ja-JP', name: voice },
      // Chirp 3 は pitch を受け付けない。少しだけ速めにして間延びを避ける。
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1.1 }
    })
  })
}

/**
 * 返事を読み上げた MP3 を base64 で返す。認証情報が無い/失敗した場合は null。
 * 呼び出し側は null を「端末の音声で読む」の合図として扱う。
 */
export async function synthesizeBase64(env: CloudflareBindings, text: string): Promise<string | null> {
  if (!env.GOOGLE_TTS_API_KEY && !env.GOOGLE_SERVICE_ACCOUNT_JSON) return null

  const preferred = env.GOOGLE_TTS_VOICE || DEFAULT_VOICE

  try {
    let res = await requestSynthesis(env, text, preferred)

    // ボイス名が使えないプロジェクトでは 400 が返るので、一段落としてもう一度だけ試す。
    if (!res.ok && res.status === 400 && preferred !== FALLBACK_VOICE) {
      console.warn(`Google TTS rejected voice ${preferred}; retrying with ${FALLBACK_VOICE}`)
      res = await requestSynthesis(env, text, FALLBACK_VOICE)
    }

    if (!res.ok) {
      console.error(`Google TTS failed: ${res.status} ${await res.text()}`)
      return null
    }

    // audioContent は base64。そのまま data URL にして返すので変換しない。
    const data = (await res.json()) as SynthesizeResponse
    return data.audioContent ?? null
  } catch (e) {
    console.error('Google TTS request failed', e)
    return null
  }
}
