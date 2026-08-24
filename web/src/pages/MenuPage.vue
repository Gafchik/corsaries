<template>
  <q-page class="menu-page column items-center q-pa-lg">
    <div class="menu-hero">
      <div class="menu-hero__emoji">🏴‍☠️</div>
      <div class="menu-hero__title">Corsaries</div>
      <div class="menu-hero__subtitle">Капитан {{ me?.first_name ?? '' }}</div>
    </div>

    <div v-if="showKickedNotice" class="kicked-notice">
      Ты открыл игру на другом устройстве — эта сессия отключена.
    </div>

    <div class="menu-actions" ref="menuRef">
      <button class="menu-btn menu-btn--primary" @click="$router.push('/world')">
        <span class="menu-btn__icon">🌊</span>
        <span class="menu-btn__text">
          <span class="menu-btn__title">В открытое море</span>
          <span class="menu-btn__desc">Плыть, встречать ботов и других игроков</span>
        </span>
      </button>

      <button v-if="showControlsEntry" class="menu-btn menu-btn--flat" @click="$router.push('/controls')">
        <span class="menu-btn__icon">🎮</span>
        <span class="menu-btn__text"><span class="menu-btn__title">Управление</span></span>
      </button>

      <button class="menu-btn menu-btn--flat" @click="logout">
        <span class="menu-btn__icon">🚪</span>
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
  background: linear-gradient(180deg, #1a2c32 0%, #142127 100%);
  color: #eef5f3;
}
.menu-hero { text-align: center; margin: 40px 0 36px; }
.menu-hero__emoji { font-size: 52px; line-height: 1; margin-bottom: 10px; }
.menu-hero__title { font-size: 26px; font-weight: 800; letter-spacing: 0.01em; }
.menu-hero__subtitle { font-size: 13px; color: #9fc2ba; margin-top: 4px; }

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
  padding: 16px 18px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05); color: #eef5f3; cursor: pointer; text-align: left;
  transition: background 0.15s;
}
.menu-btn:hover { background: rgba(255, 255, 255, 0.09); }
.menu-btn--primary {
  background: linear-gradient(135deg, #2f7d4f, #256640);
  border-color: transparent;
}
.menu-btn--primary:hover { background: linear-gradient(135deg, #369159, #2a7048); }
.menu-btn--flat { background: transparent; }
.menu-btn--flat:hover { background: rgba(255, 255, 255, 0.05); }
.menu-btn__icon { font-size: 26px; line-height: 1; flex: none; }
.menu-btn__text { display: flex; flex-direction: column; min-width: 0; }
.menu-btn__title { font-weight: 700; font-size: 15px; }
.menu-btn__desc { font-size: 12px; color: #9fc2ba; margin-top: 2px; }

/* Plain :focus, not :focus-visible — see the same note in PortPage.vue. */
.menu-page :focus {
  outline: 3px solid #6fd98a;
  outline-offset: 2px;
}
</style>
