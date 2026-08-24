import { Client } from 'colyseus.js'
import { getToken } from './api'

// Local dev talks straight to the realtime server (no dev-proxy hop needed
// for WebSocket the way /api needs one for fetch). In docker-compose this
// is still the host-published port, since the browser — not another
// container — is what connects here.
//
// Derived from the page's own hostname rather than hardcoded to 'localhost'
// — a phone on the same WiFi loads the page via the computer's LAN IP, and
// 'localhost' from the phone's perspective would mean the phone itself.
// VITE_REALTIME_URL still wins if set (e.g. a real prod domain).
const REALTIME_URL = import.meta.env.VITE_REALTIME_URL
  || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:2567`

// The same Sanctum token used for REST calls — the room's onAuth verifies it
// against Laravel's /auth/me, so there's no separate realtime-only login and
// no trusting a client-supplied name/id for who's actually connecting.
export async function joinWorld() {
  const client = new Client(REALTIME_URL)
  return client.joinOrCreate('world', { token: getToken() })
}
