import { api, getToken } from '@/services/api'
import { controls } from '@/services/controls'

export default async ({ router }) => {
  // telegram-web-app.js defines window.Telegram.WebApp unconditionally, even
  // outside the Telegram client — initData is only non-empty when Telegram
  // actually launched us, so that's the real signal, not the SDK's presence.
  if (window.Telegram?.WebApp?.initData) {
    try {
      await api.loginTelegram()
    } catch (e) {
      console.error('Telegram silent login failed', e)
    }
  }

  // Also covers the plain "already had a token from last time" case (email
  // login, Google, a returning Telegram session) — bindings should follow
  // the account on every fresh load, not just right after a fresh login.
  if (getToken()) controls.loadFromServer()

  router.beforeEach((to) => {
    if (to.path !== '/login' && !getToken()) return '/login'
    if (to.path === '/login' && getToken()) return '/'
    return true
  })
}
