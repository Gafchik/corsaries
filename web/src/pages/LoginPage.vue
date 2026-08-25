<template>
  <div class="login-page column items-center justify-center q-pa-lg">
    <div class="login-hero">
      <div class="login-hero__badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="16" y1="12" x2="21" y2="12"/><line x1="14.83" y1="14.83" x2="18.36" y2="18.36"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="9.17" y1="14.83" x2="5.64" y2="18.36"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="9.17" y1="9.17" x2="5.64" y2="5.64"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="14.83" y1="9.17" x2="18.36" y2="5.64"/></svg>
      </div>
      <div class="login-hero__title">Corsaries</div>
      <div class="login-hero__subtitle">{{ mode === 'login' ? 'Вход' : 'Регистрация' }}</div>
    </div>

    <form class="login-form" @submit.prevent="submit">
      <input v-model="firstName" v-if="mode === 'register'" class="login-input" placeholder="Имя капитана" required />
      <input v-model="email" class="login-input" type="email" placeholder="Email" required />
      <input v-model="password" class="login-input" type="password" placeholder="Пароль" minlength="8" required />

      <p v-if="error" class="login-error">{{ error }}</p>

      <button class="login-btn login-btn--primary" type="submit" :disabled="loading">
        {{ mode === 'login' ? 'Войти' : 'Создать капитана' }}
      </button>
    </form>

    <button class="login-btn login-btn--flat" @click="mode = mode === 'login' ? 'register' : 'login'">
      {{ mode === 'login' ? 'Ещё нет аккаунта? Регистрация' : 'Уже есть аккаунт? Войти' }}
    </button>

    <div id="google-signin-btn" class="q-mt-md"></div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '@/services/api'
import { controls } from '@/services/controls'

const router = useRouter()
const mode = ref('login')
const email = ref('')
const password = ref('')
const firstName = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    if (mode.value === 'login') {
      await api.login(email.value, password.value)
    } else {
      await api.register(email.value, password.value, firstName.value)
    }
    controls.loadFromServer()
    router.push('/')
  } catch (e) {
    error.value = e.message || 'Что-то пошло не так'
  } finally {
    loading.value = false
  }
}

// Google Identity Services button — renders once GOOGLE_CLIENT_ID is set and
// the script below is added; safe no-op until then.
onMounted(() => {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId || !window.google?.accounts?.id) return

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: async (resp) => {
      try {
        await api.loginGoogle(resp.credential)
        controls.loadFromServer()
        router.push('/')
      } catch (e) {
        error.value = e.message || 'Google login failed'
      }
    },
  })
  window.google.accounts.id.renderButton(document.getElementById('google-signin-btn'), { theme: 'outline', size: 'large' })
})
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  box-sizing: border-box;
  background: radial-gradient(140% 70% at 50% -10%, var(--c-bg-mid) 0%, var(--c-bg-deep) 60%), var(--c-bg-deep);
  color: var(--c-ink);
}
.login-hero { text-align: center; margin-bottom: 28px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.login-hero__badge {
  width: 64px; height: 64px; border-radius: 50%;
  border: 1px solid var(--c-border);
  background: rgba(217, 164, 65, 0.08);
  display: flex; align-items: center; justify-content: center;
  color: var(--c-gold-bright);
}
.login-hero__badge svg { width: 34px; height: 34px; }
.login-hero__title { font-family: var(--font-display); font-size: 30px; letter-spacing: 0.01em; }
.login-hero__subtitle { font-size: 13px; color: var(--c-ink-soft); }

.login-form { width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 10px; }
.login-input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: 15px;
  box-sizing: border-box;
}
.login-input::placeholder { color: var(--c-ink-faint); }
.login-input:focus { outline: 2px solid var(--c-gold-bright); outline-offset: 1px; }
.login-error { color: var(--c-danger); font-size: 13px; margin: 0; }

.login-btn {
  width: 100%;
  max-width: 320px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  cursor: pointer;
  font-weight: 700;
  margin-top: 6px;
}
.login-btn--primary { background: linear-gradient(135deg, var(--c-gold-bright), var(--c-gold)); color: #2c1c05; border-color: transparent; }
.login-btn--flat { border-color: transparent; background: transparent; font-weight: 500; color: var(--c-ink-soft); }
</style>
