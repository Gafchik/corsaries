<template>
  <q-page class="port-page">
    <div v-if="loading" class="text-center q-mt-xl">Загрузка порта...</div>

    <div v-else ref="pageRef" class="sheet">
      <!--
        Уплыть used to be the last thing in the scrolling block below, past
        up to 8 market rows — reaching it meant scrolling through the whole
        list first. Moved up here into the fixed header instead, next to the
        title where it's the first thing on screen — not just "no longer
        buried", but somewhere a glance actually finds it.
      -->
      <div class="sheet__top">
        <div class="port-hero">
          <button class="leave-btn" @click="$router.push('/world')">← Уплыть</button>
          <div class="port-hero__title">{{ port.name }}</div>
          <div class="port-hero__gold">Золото: {{ ship?.coins ?? coins }}</div>
        </div>

        <div class="tabs">
          <button v-for="t in tabs" :key="t.key" class="tab-btn" :class="{ active: tab === t.key }" @click="tab = t.key">
            {{ t.label }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
      </div>

      <div class="sheet__scroll">
        <!-- Рынок -->
        <div v-if="tab === 'market'" class="panel">
          <div class="row__sub">Количество: ◀ ▶ (или A/D) на выбранном поле</div>
          <div v-for="p in market" :key="p.type" class="row">
            <div class="row__main">
              <div class="row__title">{{ p.name }}</div>
              <div class="row__sub">{{ p.price }} зол · в наличии {{ p.stock }} · у меня {{ owned(p.type) }}</div>
            </div>
            <input
              :value="quantities[p.type]"
              @input="setQuantity(p, $event.target.value)"
              type="number"
              inputmode="numeric"
              min="1"
              :max="qtyMax(p)"
              class="qty-input"
            />
            <button class="mini-btn" :disabled="quantities[p.type] > p.stock" @click="trade(p.type, 'buy')">Купить</button>
            <button class="mini-btn mini-btn--flat" :disabled="quantities[p.type] > owned(p.type)" @click="trade(p.type, 'sell')">Продать</button>
          </div>
        </div>

        <!-- Верфь -->
        <div v-if="tab === 'shipyard'" class="panel">
          <div v-for="s in shipyard" :key="s.type" class="row">
            <div class="row__main">
              <div class="row__title">{{ s.name }} {{ s.type === ship?.type ? '(текущий)' : '' }}</div>
              <div class="row__sub">{{ s.price }} зол · HP {{ s.max_hp }} · пушек {{ s.cannon_count }} · экипаж до {{ s.max_sailors }}</div>
            </div>
            <button class="mini-btn" :disabled="s.type === ship?.type" @click="buyShip(s.type)">Купить</button>
          </div>
        </div>

        <!-- Таверна -->
        <div v-if="tab === 'tavern'" class="panel">
          <div v-for="s in tavern" :key="s.type" class="row">
            <div class="row__main">
              <div class="row__title">{{ s.name }}</div>
              <div class="row__sub">{{ s.price }} зол · на борту {{ ship?.sailors?.[s.type] ?? 0 }}</div>
            </div>
            <button class="mini-btn" @click="hireFire(s.type, 'hire')">Нанять</button>
            <button class="mini-btn mini-btn--flat" @click="hireFire(s.type, 'fire')">Уволить</button>
          </div>
          <div class="row__sub q-mt-sm">Экипаж: {{ ship?.sailor_count }} / {{ ship?.max_sailors }}</div>
        </div>

        <!-- Мастерская -->
        <div v-if="tab === 'repair'" class="panel">
          <div class="row__sub">HP: {{ ship?.hp }} / {{ ship?.max_hp }}</div>
          <div class="row__sub">Цена: {{ repairPricePerHp }} зол/HP · Не хватает: {{ missingHp }} HP</div>

          <div v-if="missingHp > 0" class="row">
            <div class="row__main">
              <div class="row__title">Сколько чинить</div>
              <div class="row__sub">Количество: ◀ ▶ (или A/D) на выбранном поле</div>
            </div>
            <input
              :value="repairAmount"
              @input="setRepairAmount($event.target.value)"
              type="number"
              inputmode="numeric"
              min="1"
              :max="missingHp"
              class="qty-input"
            />
          </div>

          <button
            class="mini-btn q-mt-sm"
            :disabled="missingHp <= 0 || repairAmount * repairPricePerHp > coins"
            @click="repair"
          >
            {{ missingHp <= 0 ? 'Корабль цел' : `Починить ${repairAmount} HP — ${repairAmount * repairPricePerHp} зол` }}
          </button>
        </div>
      </div>
    </div>

    <ShipInfoOverlay v-if="showInfo" :ship-info="ship" :coins="coins" @close="showInfo = false" />
  </q-page>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { useMenuNav } from '@/composables/useMenuNav'
import { controls } from '@/services/controls'
import ShipInfoOverlay from '@/components/ShipInfoOverlay.vue'

const route = useRoute()
const router = useRouter()
const portId = route.params.id
const pageRef = ref(null)

const loading = ref(true)
const error = ref('')
const port = ref(null)
const market = ref([])
const shipyard = ref([])
const tavern = ref([])
const repairPricePerHp = ref(1)
const ship = ref(null)
const coins = ref(0)
const tab = ref('market')
const quantities = reactive({})
const showInfo = ref(false)
const repairAmount = ref(1)

const missingHp = computed(() => Math.max(0, (ship.value?.max_hp ?? 0) - (ship.value?.hp ?? 0)))
// Repairing used to be all-or-nothing (full heal or nothing at all) — this
// is what a player would want as the starting number most of the time:
// however much of the missing HP their current gold actually covers, capped
// at "fully repaired" so it never suggests spending on HP that isn't missing.
const maxAffordableRepair = computed(() => Math.min(missingHp.value, Math.floor(coins.value / repairPricePerHp.value)))

const tabs = [
  { key: 'market', label: 'Рынок' },
  { key: 'shipyard', label: 'Верфь' },
  { key: 'tavern', label: 'Таверна' },
  { key: 'repair', label: 'Мастерская' },
]

async function load() {
  const [portData, shipData] = await Promise.all([api.getPort(portId), api.getShip()])
  port.value = portData.port
  market.value = portData.market
  shipyard.value = portData.shipyard
  tavern.value = portData.tavern
  repairPricePerHp.value = portData.repair_price_per_hp
  ship.value = shipData.ship
  coins.value = shipData.coins
  for (const p of portData.market) quantities[p.type] = 1
  repairAmount.value = maxAffordableRepair.value || 1
}

async function withErrorHandling(fn) {
  error.value = ''
  try {
    await fn()
  } catch (e) {
    error.value = e.message || 'Что-то пошло не так'
  }
}

function owned(type) {
  return ship.value?.products?.[type] ?? 0
}

// Shared by both Купить/Продать, so the input itself allows whichever of
// the two is larger — the actual per-action ceiling (can't buy more than
// the port has, can't sell more than's aboard) is enforced by disabling
// each button separately, not by this input alone.
function qtyMax(p) {
  return Math.max(p.stock, owned(p.type), 1)
}

// v-model.number alone trusted whatever the browser parsed — typing "-5"
// (still possible on a number input despite min="1", that attribute only
// affects HTML5 form-validity state, not what you can type) landed a
// negative quantity straight in reactive state. Clamped by hand here on
// every keystroke instead, same [1, qtyMax] range the gamepad ◀/▶ stepper
// in useMenuNav already enforces.
function setQuantity(product, raw) {
  const n = Math.trunc(Number(raw))
  quantities[product.type] = Math.max(1, Math.min(qtyMax(product), Number.isFinite(n) ? n : 1))
}

// Same clamp shape as setQuantity above, just against missingHp instead of
// stock/owned — never lets the player type more HP than the hull actually
// needs, or a negative amount.
function setRepairAmount(raw) {
  const n = Math.trunc(Number(raw))
  repairAmount.value = Math.max(1, Math.min(missingHp.value, Number.isFinite(n) ? n : 1))
}

async function trade(product, action) {
  await withErrorHandling(async () => {
    const qty = quantities[product] || 1
    const data = await api.trade(portId, product, action, qty)
    ship.value = data.ship
    coins.value = data.coins
  })
}

async function buyShip(type) {
  await withErrorHandling(async () => {
    const data = await api.buyShip(portId, type)
    ship.value = data.ship
    coins.value = data.coins
  })
}

async function hireFire(type, action) {
  await withErrorHandling(async () => {
    const data = await api.tavern(portId, type, action)
    ship.value = data.ship
    coins.value = data.coins
  })
}

async function repair() {
  await withErrorHandling(async () => {
    const data = await api.repair(portId, repairAmount.value)
    ship.value = data.ship
    coins.value = data.coins
    repairAmount.value = maxAffordableRepair.value || 1
  })
}

onMounted(async () => {
  // Reachable via more than just the "Войти в порт" button (browser back
  // after already sailing off, a direct/stale URL, ...) — the server now
  // rejects the very first request here (getPort) if the ship isn't
  // actually near this port right now (see PortController::proximityError),
  // so a failure here means "this page doesn't belong open," not "show a
  // banner and a broken market with nothing in it."
  try {
    await load()
  } catch {
    router.replace('/world')
    return
  }
  loading.value = false
})

// Dedicated shortcut back to the world (gamepad Circle/B by default) — same
// destination as clicking "Уплыть", just reachable without navigating focus
// to it first.
const unsubBack = controls.onPress('back', () => router.push('/world'))
// Same overlay as in the world (Triangle/Y by default) — the port's own
// tabs already show most of this, but keeping the shortcut consistent
// across screens beats a button that only works in one place.
const unsubInventory = controls.onPress('inventory', () => { showInfo.value = !showInfo.value })
// L1/R1 cycle tabs — 'tabPrev'/'tabNext' are hardcoded to those physical
// buttons (see FIXED_GAMEPAD_BUTTONS in controls.js), not tied to whatever
// the player's rebound fireLeft/fireRight to. It used to piggyback on those
// rebindable actions directly, which meant moving your fire controls (say,
// to L2/R2) silently moved tab-switching along with it too.
function cycleTab(delta) {
  const i = tabs.findIndex((t) => t.key === tab.value)
  tab.value = tabs[(i + delta + tabs.length) % tabs.length].key
}
const unsubTabPrev = controls.onPress('tabPrev', () => cycleTab(-1))
const unsubTabNext = controls.onPress('tabNext', () => cycleTab(1))
onBeforeUnmount(() => {
  unsubBack()
  unsubInventory()
  unsubTabPrev()
  unsubTabNext()
})

// Keyboard/gamepad focus navigation (see the composable) — re-scans
// whenever the tab changes AND once loading flips false, since the
// navigable buttons don't exist in the DOM until then.
const { refreshItems } = useMenuNav(pageRef, { watchSource: () => [tab.value, loading.value] })

// Купить/Продать disable themselves once quantity exceeds what's actually
// available (see qtyMax/owned) — a lighter re-scan than the one above,
// deliberately not resetting focus/index, since this fires on every single
// ±1 nudge of the quantity input the player is actively sitting on.
// nextTick, not a bare call — see the identical note in AbordagePage.vue
// about Vue's default 'pre' watcher flush running before the DOM actually
// drops a button's disabled attribute.
watch(quantities, () => nextTick(refreshItems), { deep: true })
// Same reasoning as the quantities watch above — the Починить button
// disables itself once the chosen amount costs more than the wallet holds.
watch(repairAmount, () => nextTick(refreshItems))
</script>

<style scoped>
.port-page {
  min-height: 100vh;
  background: linear-gradient(180deg, #1a2c32 0%, #142127 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.text-center.q-mt-xl { color: #9fc2ba; }

.sheet {
  width: min(480px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #1a2c32 0%, #142127 100%);
  border: 1px solid #2c4046;
  border-radius: 16px;
  padding: 22px 20px;
  color: #eef5f3;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}
.sheet__top { flex: none; }
.sheet__scroll {
  flex: 1;
  /* Without this a flex child won't actually shrink below its content's
     natural height, so it'd just grow the whole .sheet past max-height
     instead of scrolling internally — the one part of this trick that's
     easy to miss and silently breaks the whole point of splitting it out. */
  min-height: 0;
  overflow-y: auto;
}

.port-hero { position: relative; text-align: center; margin-bottom: 18px; }
.port-hero__title { font-size: 22px; font-weight: 800; }
.port-hero__gold { font-size: 14px; font-weight: 700; color: #ffd166; margin-top: 4px; }

.tabs { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
.tab-btn {
  flex: 1;
  padding: 9px 4px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: #eef5f3;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.tab-btn.active { background: linear-gradient(135deg, #2f7d4f, #256640); border-color: transparent; color: #fff; }

.error-text { color: #ff8080; font-size: 13px; margin-bottom: 8px; }

.panel { display: flex; flex-direction: column; gap: 8px; }
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}
.row__main { flex: 1; min-width: 0; }
.row__title { font-weight: 700; font-size: 14px; }
.row__sub { font-size: 12px; color: #9fc2ba; }

.qty-input {
  width: 52px; padding: 7px; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #eef5f3;
  text-align: center;
  /* Number input spinner — ◀ ▶ / A/D already do this job. */
  -moz-appearance: textfield;
  appearance: textfield;
}
.qty-input::-webkit-outer-spin-button,
.qty-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.mini-btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #2f7d4f, #256640);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.mini-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.mini-btn--flat {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #eef5f3;
}

.leave-btn {
  position: absolute;
  left: 0;
  top: 0;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #eef5f3;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* Keyboard/gamepad focus navigation (see useMenuNav) relies on this being
   visible. Plain :focus, not :focus-visible — a gamepad button press
   triggers focus via a plain JS .focus() call, and browsers don't
   consistently treat that as "should show the ring" the way a real
   keydown does, so :focus-visible could silently disappear on a gamepad. */
.port-page :focus {
  outline: 3px solid #6fd98a;
  outline-offset: 2px;
}
</style>
