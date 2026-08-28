<template>
  <q-page class="controls-page">
    <div ref="pageRef" class="sheet">
    <div class="header">
      <button class="back-btn" @click="$router.back()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15,4 7,12 15,20"/></svg>
        Назад
      </button>
      <div class="title">Управление</div>
    </div>

    <div class="tabs">
      <button v-for="t in tabs" :key="t.key" class="tab-btn" :class="{ active: tab === t.key }" @click="tab = t.key">
        <svg v-if="t.key === 'keyboard'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><line x1="6" y1="10" x2="6" y2="10"/><line x1="10" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="14" y2="10"/><line x1="18" y1="10" x2="18" y2="10"/><line x1="6" y1="14" x2="18" y2="14"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="5"/><line x1="7" y1="12" x2="7" y2="12"/><line x1="17" y1="11" x2="17" y2="11"/></svg>
        {{ t.label }}
      </button>
    </div>

    <div v-if="tab === 'keyboard'" class="section">
      <!-- Free aim (see fireFree/updateAiming in WorldPage.vue) is mouse-only
           on keyboard — hold, aim toward the cursor, release to fire — the
           same way a mouse button always has been, never through this
           rebind system. Without this note, fire quietly not being in the
           list below (it used to have its own Q/E row) reads as something
           missing rather than something that moved on purpose. -->
      <div class="row__label row__label--note">Прицел и выстрел — мышью (навёл, отпустил), не привязывается</div>
      <div class="row" v-for="a in KEYBOARD_ACTIONS" :key="'kb-' + a">
        <div class="row__label">{{ ACTION_LABELS[a] }}</div>
        <button
          class="bind-btn"
          :class="{ 'bind-btn--capturing': capturing === `keyboard:${a}` }"
          @click="rebind('keyboard', a)"
        >
          {{ capturing === `keyboard:${a}` ? 'Нажмите клавишу…' : keyLabel(bindings.keyboard[a]) }}
        </button>
      </div>
    </div>

    <div v-else class="section">
      <div class="section__hint-row">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="5"/><line x1="7" y1="12" x2="7" y2="12"/><line x1="17" y1="11" x2="17" y2="11"/></svg>
        {{ gamepadConnected ? 'Геймпад подключён' : 'Геймпад не обнаружен' }}
      </div>
      <div class="row__label row__label--note">Движение — левый стик, прицел — правый стик — тут только кнопки</div>
      <div class="row" v-for="a in GAMEPAD_ACTIONS" :key="'gp-' + a">
        <div class="row__label">{{ ACTION_LABELS[a] }}</div>
        <button
          class="bind-btn"
          :class="{ 'bind-btn--capturing': capturing === `gamepad:${a}` }"
          @click="rebind('gamepad', a)"
        >
          {{ capturing === `gamepad:${a}` ? 'Нажмите кнопку…' : (GAMEPAD_BUTTON_LABELS[bindings.gamepad[a]] ?? bindings.gamepad[a]) }}
        </button>
      </div>
    </div>

    <div class="footer">
      <button v-if="capturing" class="cancel-btn" @click="cancel">Отменить (Esc)</button>
      <button class="reset-btn" @click="reset">Сбросить на умолчания</button>
    </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { controls, hasRebindableInput, isPhone, ACTION_LABELS, GAMEPAD_BUTTON_LABELS, MOVE_ACTIONS, PRESS_ACTIONS, GAMEPAD_ONLY_ACTIONS } from '@/services/controls'
import { useMenuNav } from '@/composables/useMenuNav'

const router = useRouter()
// Reachable by URL even with the menu entry hidden — bounce back if there's
// no keyboard/gamepad context to actually rebind anything in. (A paired but
// untouched Bluetooth gamepad won't count yet — see hasRebindableInput.)
if (!hasRebindableInput()) router.replace('/')

const KEYBOARD_ACTIONS = [...MOVE_ACTIONS, ...PRESS_ACTIONS]
// 'fire' has no keyboard equivalent (a mouse click drives it directly, see
// controls.js's own comment) — only the gamepad tab offers it to rebind.
const GAMEPAD_ACTIONS = [...PRESS_ACTIONS, ...GAMEPAD_ONLY_ACTIONS]
const pageRef = ref(null)

const bindings = ref(structuredClone(controls.getBindings()))
const capturing = ref(null) // `${deviceType}:${action}` while waiting for input
const gamepadConnected = ref(!!controls.firstGamepad())

// A phone has no physical keyboard, so once it has an actual gamepad paired
// there's nothing for the keyboard tab to rebind — only offer Controller.
// (A phone with no gamepad never reaches this page at all — see the
// hasRebindableInput() bounce above.)
const tabs = computed(() =>
  isPhone() && gamepadConnected.value
    ? [{ key: 'gamepad', label: 'Контроллер' }]
    : [
        { key: 'keyboard', label: 'Клавиатура' },
        { key: 'gamepad', label: 'Контроллер' },
      ],
)
const tab = ref(tabs.value[0].key)
watch(tabs, (newTabs) => {
  if (!newTabs.some((t) => t.key === tab.value)) tab.value = newTabs[0].key
})

function cycleTab(delta) {
  const i = tabs.value.findIndex((t) => t.key === tab.value)
  tab.value = tabs.value[(i + delta + tabs.value.length) % tabs.value.length].key
}

function keyLabel(code) {
  // KeyboardEvent.code values are already fairly readable ('KeyW', 'Space',
  // 'ArrowUp') — just drop the 'Key'/'Digit' prefix for the common cases.
  return code?.replace(/^Key/, '').replace(/^Digit/, '') ?? '—'
}

async function rebind(deviceType, action) {
  capturing.value = `${deviceType}:${action}`
  const value = await controls.captureNext(deviceType)
  capturing.value = null
  if (value === null) return // cancelled
  controls.setBinding(deviceType, action, value)
  bindings.value = structuredClone(controls.getBindings())
}

function cancel() {
  controls.cancelCapture()
  capturing.value = null
}

function reset() {
  controls.resetBindings()
  bindings.value = structuredClone(controls.getBindings())
}

let gamepadPollTimer = null
onMounted(() => {
  // Just for the "подключён/не обнаружен" hint — the connectivity events
  // (gamepadconnected) are unreliable across browsers, a light poll isn't.
  gamepadPollTimer = setInterval(() => { gamepadConnected.value = !!controls.firstGamepad() }, 1000)
})
// Dedicated shortcut back to the menu (gamepad Circle/B, or Escape — same
// as it does everywhere else). Note this is separate from Escape's other
// job of cancelling an in-progress capture (see controls.js's handleKeydown)
// — mid-capture, Escape only cancels that; press it again to actually leave.
const unsubBack = controls.onPress('back', () => router.back())
// L1/R1 cycle the two tabs, same convention as Port — hardcoded to those
// physical buttons (see FIXED_GAMEPAD_BUTTONS in controls.js), not to
// whatever fireLeft/fireRight currently are, so rebinding fire controls
// here can't also drag tab-switching along with it. Harmless during a
// capture — controls.js already suppresses this emission while
// isCapturing() (see its handleKeydown/update), so a bind press here can't
// also flip tabs mid-capture.
const unsubTabPrev = controls.onPress('tabPrev', () => cycleTab(-1))
const unsubTabNext = controls.onPress('tabNext', () => cycleTab(1))

onBeforeUnmount(() => {
  clearInterval(gamepadPollTimer)
  controls.cancelCapture()
  unsubBack()
  unsubTabPrev()
  unsubTabNext()
})

// Up/down + action navigates this page too — without it, a controller-only
// player could never reach a "rebind" button in the first place. Paused
// automatically while a capture is in progress (see isCapturing() in
// useMenuNav's frameLoop). Re-scans when the tab or the "Отменить" button changes.
useMenuNav(pageRef, { watchSource: () => [tab.value, capturing.value] })
</script>

<style scoped>
.controls-page {
  min-height: 100vh;
  background: radial-gradient(140% 70% at 50% -10%, var(--c-bg-mid) 0%, var(--c-bg-deep) 60%), var(--c-bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.sheet {
  width: min(480px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--c-bg-deep);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  padding: 22px 20px;
  color: var(--c-ink);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}

.header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.back-btn { display: flex; align-items: center; gap: 6px; background: none; border: none; font-size: 14px; cursor: pointer; color: var(--c-ink-soft); padding: 0; }
.title { font-family: var(--font-display); font-size: 22px; letter-spacing: 0.01em; }

.tabs { display: flex; gap: 6px; margin-bottom: 18px; }
.tab-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 9px 4px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink-soft);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.tab-btn svg { width: 17px; height: 17px; }
.tab-btn.active { background: rgba(217, 164, 65, 0.14); border-color: rgba(217, 164, 65, 0.4); color: var(--c-gold-bright); }

.section { margin-bottom: 22px; }
.section__hint-row { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--c-ink-soft); margin-bottom: 10px; }

.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--c-border); }
.row__label { font-size: 14px; }
.row__label--note { font-size: 12px; color: var(--c-ink-faint); border-bottom: none; padding-bottom: 4px; }

.bind-btn {
  min-width: 130px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}
.bind-btn--capturing { border-color: var(--c-gold-bright); color: var(--c-gold-bright); background: rgba(217, 164, 65, 0.1); }

.footer { display: flex; gap: 10px; margin-top: 16px; }
.cancel-btn, .reset-btn {
  padding: 10px 16px; border-radius: 10px; border: 1px solid var(--c-border);
  background: var(--c-surface); color: var(--c-ink); cursor: pointer; font-size: 13px;
}
.cancel-btn { border-color: var(--c-danger); color: var(--c-danger); background: rgba(226, 104, 94, 0.1); }

/* Plain :focus, not :focus-visible — see the same note in PortModal.vue. */
.controls-page :focus {
  outline: 3px solid var(--c-gold-bright);
  outline-offset: 2px;
}
</style>
