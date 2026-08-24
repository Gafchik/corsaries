export function myTelegramUser() {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user
  return {
    name: user?.first_name ?? 'Ты',
    photoUrl: user?.photo_url ?? null,
  }
}
