export default () => {
  const tg = window.Telegram?.WebApp

  if (!tg) {
    console.warn('Telegram WebApp SDK not found — running as a plain website, Google/email login applies.')
    return
  }

  tg.ready()
  tg.expand()
}
