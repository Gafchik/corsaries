<template>
  <q-page class="menu-page column items-center q-pa-lg">
    <div class="menu-hero">
      <div class="menu-hero__badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="16" y1="12" x2="21" y2="12"/><line x1="14.83" y1="14.83" x2="18.36" y2="18.36"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="9.17" y1="14.83" x2="5.64" y2="18.36"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="9.17" y1="9.17" x2="5.64" y2="5.64"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="14.83" y1="9.17" x2="18.36" y2="5.64"/></svg>
      </div>
      <div class="menu-hero__title">Corsaries</div>
      <div class="menu-hero__subtitle">Капитан {{ me?.first_name ?? '' }}</div>
    </div>

    <div v-if="showKickedNotice" class="kicked-notice">
      Ты открыл игру на другом устройстве — эта сессия отключена.
    </div>

    <div class="menu-actions" ref="menuRef">
      <button class="menu-btn menu-btn--primary" @click="$router.push('/world')">
        <span class="menu-btn__icon menu-btn__icon--primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 L12 16 L6 16 Z"/><line x1="12" y1="3" x2="12" y2="18"/><path d="M4 18 Q12 22 20 18"/></svg>
        </span>
        <span class="menu-btn__text">
          <span class="menu-btn__title">В открытое море</span>
          <span class="menu-btn__desc">Плыть, встречать ботов и других игроков</span>
        </span>
      </button>

      <button v-if="showControlsEntry" class="menu-btn menu-btn--flat" @click="$router.push('/controls')">
        <span class="menu-btn__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="4" rx="2"/><rect x="4" y="14" width="16" height="4" rx="2"/></svg>
        </span>
        <span class="menu-btn__text"><span class="menu-btn__title">Управление</span></span>
      </button>

      <button class="menu-btn menu-btn--flat" @click="logout">
        <span class="menu-btn__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="10" height="18" rx="1"/><circle cx="13" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M17 8 L21 12 L17 16"/><line x1="21" y1="12" x2="10" y2="12"/></svg>
        </span>
        <span class="menu-btn__text"><span class="menu-btn__title">Выйти</span></span>
      </button>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { api } from '@/services/api'
import { hasRebindableInput, onGamepadChange } from '@/services/controls'
import { useMenuNav } from '@/composables/useMenuNav'

const router = useRouter()
const route = useRoute()
const me = ref(null)
const menuRef = ref(null)
// Set by WorldPage when this session gets a server-side takeover kick (see
// WorldRoom.onJoin) — a one-shot notice, not a persistent banner, so the
// query param is stripped right after reading it.
const showKickedNotice = ref(route.query.kicked === '1')
if (showKickedNotice.value) router.replace({ path: '/' })
// Reactive, not a one-time check — a Bluetooth gamepad paired to a phone
// only shows up in the Gamepad API after its first button press, so this
// can go from hidden to visible while the player is sitting right here.
const showControlsEntry = ref(hasRebindableInput())
let stopGamepadWatch = null

onMounted(async () => {
  stopGamepadWatch = onGamepadChange(() => { showControlsEntry.value = hasRebindableInput() })

  try {
    const data = await api.me()
    me.value = data.user
  } catch {
    router.push('/login')
  }
})

onBeforeUnmount(() => stopGamepadWatch?.())

async function logout() {
  await api.logout()
  router.push('/login')
}

// Up/down + action navigates the menu with a keyboard or a gamepad — re-scans
// when the "Управление" entry appears/disappears (a gamepad connecting mid-visit).
useMenuNav(menuRef, { watchSource: showControlsEntry })
</script>

<style scoped>
.menu-page {
  min-height: 100vh;
  box-sizing: border-box;
  background: radial-gradient(140% 70% at 50% -10%, var(--c-bg-mid) 0%, var(--c-bg-deep) 60%), var(--c-bg-deep);
  color: var(--c-ink);
}
.menu-hero { text-align: center; margin: 40px 0 36px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.menu-hero__badge {
  width: 64px; height: 64px; border-radius: 50%;
  border: 1px solid var(--c-border);
  background: rgba(217, 164, 65, 0.08);
  display: flex; align-items: center; justify-content: center;
  color: var(--c-gold-bright);
}
.menu-hero__badge svg { width: 34px; height: 34px; }
.menu-hero__title { font-family: var(--font-display); font-size: 30px; letter-spacing: 0.01em; }
.menu-hero__subtitle { font-size: 13px; color: var(--c-ink-soft); }

.kicked-notice {
  width: 100%;
  max-width: 360px;
  margin-bottom: 18px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 209, 102, 0.35);
  background: rgba(255, 209, 102, 0.1);
  color: #ffd166;
  font-size: 13px;
  text-align: center;
}

.menu-actions { width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 10px; }
.menu-btn {
  display: flex; align-items: center; gap: 14px; width: 100%;
  padding: 16px 18px; border-radius: 14px; border: 1px solid var(--c-border);
  background: var(--c-surface); color: var(--c-ink); cursor: pointer; text-align: left;
  transition: background 0.15s;
}
.menu-btn:hover { background: var(--c-surface-hover); }
.menu-btn--primary {
  background: linear-gradient(135deg, var(--c-gold-bright), var(--c-gold));
  color: #2c1c05;
  border-color: transparent;
}
.menu-btn--primary:hover { background: linear-gradient(135deg, #f3d485, #e0ac4d); }
.menu-btn--flat { background: transparent; }
.menu-btn--flat:hover { background: var(--c-surface); }
.menu-btn__icon {
  flex: none; width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.06); color: var(--c-ink-soft);
}
.menu-btn__icon--primary { background: rgba(0, 0, 0, 0.15); color: #2c1c05; }
.menu-btn__icon svg { width: 22px; height: 22px; }
.menu-btn__text { display: flex; flex-direction: column; min-width: 0; }
.menu-btn__title { font-weight: 700; font-size: 15px; }
.menu-btn__desc { font-size: 12px; color: var(--c-ink-faint); margin-top: 2px; }
.menu-btn--primary .menu-btn__desc { color: rgba(44, 28, 5, 0.7); }

/* Plain :focus, not :focus-visible — see the same note in PortModal.vue. */
.menu-page :focus {
  outline: 3px solid var(--c-gold-bright);
  outline-offset: 2px;
}
</style>
