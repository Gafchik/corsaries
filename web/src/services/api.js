const TOKEN_KEY = 'corsaries_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

function initData() {
  return window.Telegram?.WebApp?.initData ?? ''
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }

  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`
  if (initData()) headers['X-Telegram-Init-Data'] = initData()

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`)
    err.status = res.status
    err.body = data
    throw err
  }

  return data
}

export const api = {
  // auth — each of these stores the returned token as a side effect
  loginTelegram: async () => {
    const data = await request('/auth/telegram', { method: 'POST', auth: false })
    setToken(data.token)
    return data.user
  },
  register: async (email, password, firstName) => {
    const data = await request('/auth/register', {
      method: 'POST',
      auth: false,
      body: { email, password, first_name: firstName },
    })
    setToken(data.token)
    return data.user
  },
  login: async (email, password) => {
    const data = await request('/auth/login', { method: 'POST', auth: false, body: { email, password } })
    setToken(data.token)
    return data.user
  },
  loginGoogle: async (idToken) => {
    const data = await request('/auth/google', { method: 'POST', auth: false, body: { id_token: idToken } })
    setToken(data.token)
    return data.user
  },
  linkTelegram: () => request('/auth/link/telegram', { method: 'POST' }),
  linkGoogle: (idToken) => request('/auth/link/google', { method: 'POST', body: { id_token: idToken } }),
  me: () => request('/auth/me'),
  logout: async () => {
    await request('/auth/logout', { method: 'POST' })
    setToken(null)
  },

  // controls (per-account key/gamepad bindings — see services/controls.js)
  getControls: () => request('/controls'),
  saveControls: (bindings) => request('/controls', { method: 'PUT', body: bindings }),

  // ship & ports
  getShip: () => request('/ship'),
  listPorts: () => request('/ports'),
  getPort: (portId) => request(`/ports/${portId}`),
  trade: (portId, product, action, quantity) =>
    request(`/ports/${portId}/trade`, { method: 'POST', body: { product, action, quantity } }),
  buyShip: (portId, type) => request(`/ports/${portId}/shipyard`, { method: 'POST', body: { type } }),
  tavern: (portId, type, action) => request(`/ports/${portId}/tavern`, { method: 'POST', body: { type, action } }),
  // amount is HP, not gold — the server derives cost from its own price
  // (see PortController::repair), this is just "how much to buy back".
  repair: (portId, amount) => request(`/ports/${portId}/repair`, { method: 'POST', body: { amount } }),

  // abordage
  startAbordagePve: (botShipType) => request('/abordage/pve', { method: 'POST', body: { bot_ship_type: botShipType } }),
  getAbordage: (id) => request(`/abordage/${id}`),
  submitAbordageMove: (id, attack, defend) => request(`/abordage/${id}/move`, { method: 'POST', body: { attack, defend } }),

  // loot
  getLootOffer: (id) => request(`/loot/${id}`),
  claimLoot: (id, items) => request(`/loot/${id}/claim`, { method: 'POST', body: { items } }),
}
