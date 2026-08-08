const STORAGE_KEY = 'otayori:client-id'

/**
 * このブラウザ専用の ID。Agent のインスタンス名に使うことで、
 * 書いたお便りは他の誰からも見えない自分だけの状態になる。
 */
export function getClientId(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored

  const id = crypto.randomUUID()
  localStorage.setItem(STORAGE_KEY, id)
  return id
}
