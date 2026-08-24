<template>
  <div class="login-page column items-center justify-center q-pa-lg">
    <div class="login-hero">
      <div class="login-hero__emoji">🏴‍☠️</div>
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
  background: linear-gradient(180deg, #1a2c32 0%, #142127 100%);
  color: #eef5f3;
}
.login-hero { text-align: center; margin-bottom: 28px; }
.login-hero__emoji { font-size: 52px; line-height: 1; margin-bottom: 10px; }
.login-hero__title { font-size: 26px; font-weight: 800; letter-spacing: 0.01em; }
.login-hero__subtitle { font-size: 13px; color: #9fc2ba; margin-top: 4px; }

.login-form { width: 100%; max-width: 320px; display: flex; flex-direction: column; gap: 10px; }
.login-input {
  width: 100%;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #eef5f3;
  font-size: 15px;
  box-sizing: border-box;
}
.login-input::placeholder { color: #6f8b85; }
.login-input:focus { outline: 2px solid #6fd98a; outline-offset: 1px; }
.login-error { color: #ff8080; font-size: 13px; margin: 0; }

.login-btn {
  width: 100%;
  max-width: 320px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #eef5f3;
  cursor: pointer;
  font-weight: 700;
  margin-top: 6px;
}
.login-btn--primary { background: linear-gradient(135deg, #2f7d4f, #256640); color: #fff; border-color: transparent; }
.login-btn--flat { border-color: transparent; background: transparent; font-weight: 500; color: #9fc2ba; }
</style>
