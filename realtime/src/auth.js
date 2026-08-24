// Delegates token verification to Laravel rather than re-implementing
// Sanctum's hashing here — one source of truth for "is this token valid".
const API_URL = process.env.LARAVEL_API_URL ?? 'http://127.0.0.1:8090/api'

export async function verifyToken(token) {
  if (!token) return null

  const response = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok) return null

  const { user } = await response.json()
  return user
}

// Same principle as verifyToken: act on a player's behalf using their own
// already-verified token rather than inventing a separate service-to-service
// auth scheme just for WorldRoom-initiated requests like starting a duel.
export async function laravelPost(path, token, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  if (!response.ok) return null
  return response.json()
}

// No player token involved — /public/ports isn't gated by auth (see
// routes/api.php), just a plain GET for WorldRoom's port-safe-zone check.
export async function laravelGetPorts() {
  const response = await fetch(`${API_URL}/public/ports`)
  if (!response.ok) return []
  const { ports } = await response.json()
  return ports
}
