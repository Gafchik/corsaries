<template>
  <div class="port-modal" @click.self="close">
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
          <button class="leave-btn" @click="close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15,4 7,12 15,20"/></svg>
            Уплыть
          </button>
          <div class="port-hero__title">{{ port.name }}</div>
          <div class="port-hero__gold">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/></svg>
            {{ ship?.coins ?? coins }}
          </div>
        </div>

        <div class="tabs">
          <button v-for="t in tabs" :key="t.key" class="tab-btn" :class="{ active: tab === t.key }" @click="tab = t.key">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" v-html="t.icon"></svg>
            {{ t.label }}
          </button>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>
      </div>

      <div class="sheet__scroll">
        <!-- Рынок -->
        <div v-if="tab === 'market'" class="panel">
          <div class="market-toolbar">
            <div class="row__sub">Количество: ◀ ▶ (или A/D) на выбранном поле</div>
            <button v-if="hasCargo" class="mini-btn mini-btn--flat" @click="sellAll">Продать всё</button>
          </div>
          <div v-for="p in market" :key="p.type" class="row">
            <div class="row__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" v-html="productIcon(p.type)"></svg></div>
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
            <div class="row__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,10 9,4 13,8 7,14"/><line x1="6" y1="13" x2="12" y2="21"/></svg></div>
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
            <div class="row__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="10" height="11" rx="1"/><path d="M15 10 h3 a3 3 0 0 1 0 6 h-3"/></svg></div>
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

        <!-- Оружейник -->
        <div v-if="tab === 'gunsmith'" class="panel panel--gunsmith">
          <div class="row__sub">Каждая пушка качается отдельно — урон/дальность/скорость ядра растут вместе</div>
          <div class="cannon-grid">
            <div v-for="c in cannons" :key="c.slot" class="cannon-card" :class="{ 'cannon-card--maxed': c.upgrade_cost === null }">
              <svg class="cannon-card__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="14" height="7" rx="3"/><circle cx="19" cy="12.5" r="4"/></svg>
              <div class="cannon-card__title">Пушка {{ c.slot + 1 }}</div>
              <div class="cannon-card__level">ур. {{ c.level }}/{{ c.max_level }}</div>
              <div class="cannon-card__stats">{{ c.stats.damage }} урон · {{ c.stats.range }} дальн. · {{ c.stats.speed }} ск. · {{ (c.stats.reload_ms / 1000).toFixed(2) }}с перезар.</div>
              <button
                v-if="c.upgrade_cost !== null"
                class="mini-btn cannon-card__btn"
                :disabled="c.upgrade_cost > coins"
                @click="upgradeCannon(c.slot)"
              >
                Улучшить — {{ c.upgrade_cost }} зол
              </button>
              <div v-else class="cannon-card__maxed-badge">Максимум</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ShipInfoOverlay v-if="showInfo" :ship-info="ship" :coins="coins" @close="showInfo = false" />
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { Notify } from 'quasar'
import { api } from '@/services/api'
import { useMenuNav } from '@/composables/useMenuNav'
import { controls } from '@/services/controls'
import ShipInfoOverlay from '@/components/ShipInfoOverlay.vue'

const props = defineProps({
  portId: { type: [String, Number], required: true },
})
const emit = defineEmits(['close'])
function close() {
  emit('close')
}

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
const cannons = ref([])
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
  { key: 'market', label: 'Рынок', icon: '<rect x="4" y="7" width="16" height="13" rx="1"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="7" x2="12" y2="20"/>' },
  { key: 'shipyard', label: 'Верфь', icon: '<polygon points="3,10 9,4 13,8 7,14"/><line x1="6" y1="13" x2="12" y2="21"/>' },
  { key: 'tavern', label: 'Таверна', icon: '<rect x="5" y="8" width="10" height="11" rx="1"/><path d="M15 10 h3 a3 3 0 0 1 0 6 h-3"/>' },
  { key: 'repair', label: 'Мастерская', icon: '<path d="M8.5 6.5a3 3 0 1 0 4.24 4.24"/><line x1="11.5" y1="9.5" x2="18" y2="16"/><path d="M16 14l3.5 3.5a2 2 0 1 1-2.83 2.83L13 17"/>' },
  { key: 'gunsmith', label: 'Оружейник', icon: '<rect x="2" y="9" width="14" height="7" rx="3"/><circle cx="19" cy="12.5" r="4"/>' },
]

// Товары рынка (см. api/config/products.php) — по одной узнаваемой пиктограмме
// на тип, вместо голого текста в списке. default — трюмный ящик для любого
// типа, которого тут нет (на случай, если конфиг продуктов пополнят).
const PRODUCT_ICONS = {
  rum: '<rect x="10" y="2" width="4" height="5"/><path d="M8 9 L10 6 H14 L16 9 V19 a2 2 0 0 1-2 2 H10 a2 2 0 0 1-2-2 Z"/>',
  silk: '<rect x="4" y="9" width="16" height="10" rx="2"/><path d="M4 9 Q8 5 12 9 T20 9"/>',
  water: '<path d="M12 3 C12 3 6 11 6 15.5 A6 6 0 0 0 18 15.5 C18 11 12 3 12 3 Z"/>',
  food: '<path d="M3 12 C6 7 14 7 17 12 C14 17 6 17 3 12 Z"/><path d="M17 12 L21 9 V15 Z"/>',
  leather: '<path d="M8 9 C8 6 10 4 12 4 C14 4 16 6 16 9"/><path d="M6 9 H18 L17 20 a2 2 0 0 1-2 2 H9 a2 2 0 0 1-2-2 Z"/>',
  wood: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  tobacco: '<path d="M4 20 C4 10 10 4 20 4 C20 14 14 20 4 20 Z"/><path d="M6 18 L18 6"/>',
  coffee: '<path d="M5 9 h11 v6 a5 5 0 0 1-5 5 H10 a5 5 0 0 1-5-5 Z"/><path d="M16 10 h2 a3 3 0 0 1 0 6 h-2"/><path d="M9 5 q1-2 0-4"/><path d="M13 5 q1-2 0-4"/>',
  default: '<rect x="4" y="7" width="16" height="13" rx="1"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="7" x2="12" y2="20"/>',
}
function productIcon(type) {
  return PRODUCT_ICONS[type] ?? PRODUCT_ICONS.default
}

async function load() {
  const [portData, shipData, cannonData] = await Promise.all([api.getPort(props.portId), api.getShip(), api.getCannons(props.portId)])
  port.value = portData.port
  market.value = portData.market
  shipyard.value = portData.shipyard
  tavern.value = portData.tavern
  repairPricePerHp.value = portData.repair_price_per_hp
  ship.value = shipData.ship
  coins.value = shipData.coins
  cannons.value = cannonData.cannons
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

const hasCargo = computed(() => market.value.some((p) => owned(p.type) > 0))

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
    const data = await api.trade(props.portId, product, action, qty)
    ship.value = data.ship
    coins.value = data.coins
  })
}

// No bulk-sell endpoint — sequential single-product sells instead, one row
// at a time. Sequential (not Promise.all) so each response's fresh
// ship/coins state feeds the next iteration's owned() reads, rather than
// racing several trades against the same stale snapshot.
async function sellAll() {
  await withErrorHandling(async () => {
    for (const p of market.value) {
      const qty = owned(p.type)
      if (qty <= 0) continue
      const data = await api.trade(props.portId, p.type, 'sell', qty)
      ship.value = data.ship
      coins.value = data.coins
    }
  })
}

async function buyShip(type) {
  await withErrorHandling(async () => {
    const data = await api.buyShip(props.portId, type)
    ship.value = data.ship
    coins.value = data.coins
    // A bigger hull can mean more cannon slots (see Ship::ensureCannonSlots,
    // run server-side on every purchase) — re-fetch so the Оружейник tab
    // shows them without needing a full page reload.
    cannons.value = (await api.getCannons(props.portId)).cannons
    notifyShipSwap(data.refund)
  })
}

// Every swap resets cannons to stock level 0 (see PortController::buyShip)
// — worth saying out loud, not just quietly reflected in the Оружейник tab
// a click later. A downgrade also gets gold back for the old hull/cannons
// it's leaving behind; nothing to say when that's zero (a plain upgrade).
function notifyShipSwap(refund) {
  if (refund?.total > 0) {
    Notify.create({
      type: 'positive',
      position: 'top',
      message: `Корабль продан за ${refund.ship} золота, пушки за ${refund.cannons} золота (${refund.total} всего). Новые пушки — с нуля.`,
    })
  } else {
    Notify.create({ type: 'info', position: 'top', message: 'Пушки нового корабля начинают с уровня 0.' })
  }
}

async function hireFire(type, action) {
  await withErrorHandling(async () => {
    const data = await api.tavern(props.portId, type, action)
    ship.value = data.ship
    coins.value = data.coins
  })
}

async function repair() {
  await withErrorHandling(async () => {
    const data = await api.repair(props.portId, repairAmount.value)
    ship.value = data.ship
    coins.value = data.coins
    repairAmount.value = maxAffordableRepair.value || 1
  })
}

async function upgradeCannon(slot) {
  await withErrorHandling(async () => {
    const data = await api.upgradeCannon(props.portId, slot)
    cannons.value = data.cannons
    coins.value = data.coins
  })
}

onMounted(async () => {
  // Reachable only while the ship is actually near this port (the "Войти в
  // порт" prompt in WorldPage only opens this modal when nearPort is set)
  // — but the server still re-checks proximity itself on this very first
  // request (see PortController::proximityError), so a failure here means
  // something changed between the prompt showing and this load actually
  // landing (moved off, connection hiccup), not a broken market to show.
  try {
    await load()
  } catch {
    close()
    return
  }
  loading.value = false
})

// Dedicated shortcut back to the world (gamepad Circle/B by default) — same
// destination as clicking "Уплыть", just reachable without navigating focus
// to it first.
const unsubBack = controls.onPress('back', close)
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
.port-modal {
  position: absolute;
  inset: 0;
  z-index: 22;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
  background: rgba(6, 12, 15, 0.6);
}
.text-center.q-mt-xl { color: var(--c-ink-soft); }

.sheet {
  width: min(480px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--c-bg-deep);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  padding: 18px 18px 0;
  color: var(--c-ink);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  overflow: hidden;
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
  /* Пергамент как «прилавок»: рынок/верфь/таверна/ремонт читаются как
     конторская книга, в отличие от тёмного каркаса вокруг них. */
  background: var(--c-parchment);
  border-radius: 16px 16px 0 0;
  margin-top: 12px;
  padding: 16px 4px 20px;
  box-shadow: 0 -8px 20px rgba(0, 0, 0, 0.3);
}

.port-hero { position: relative; text-align: center; margin-bottom: 16px; padding-top: 2px; }
.port-hero__title { font-family: var(--font-display); font-size: 22px; letter-spacing: 0.01em; }
.port-hero__gold {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 14px; font-weight: 700; color: var(--c-gold-bright); margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.tabs { display: flex; gap: 6px; margin-bottom: 4px; flex-wrap: wrap; }
.tab-btn {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 9px 4px 8px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink-soft);
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 700;
}
.tab-btn svg { width: 19px; height: 19px; }
.tab-btn.active { background: rgba(217, 164, 65, 0.14); border-color: rgba(217, 164, 65, 0.4); color: var(--c-gold-bright); }

.error-text { color: var(--c-danger); font-size: 13px; margin: 8px 0 0; }

.panel { display: flex; flex-direction: column; gap: 2px; padding: 0 12px; }
.panel > .row__sub { color: var(--c-parchment-ink-soft); margin-bottom: 4px; }
.market-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.market-toolbar .row__sub { margin-bottom: 0; }
.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 4px;
  border-bottom: 1px solid var(--c-parchment-border);
}
.row__icon {
  flex: none; width: 34px; height: 34px; border-radius: 8px;
  background: rgba(44, 35, 20, 0.06);
  display: flex; align-items: center; justify-content: center;
  color: var(--c-parchment-ink-soft);
}
.row__icon svg { width: 18px; height: 18px; }
.row__main { flex: 1; min-width: 0; }
.row__title { font-weight: 700; font-size: 14px; color: var(--c-parchment-ink); }
.row__sub { font-size: 12px; color: var(--c-parchment-ink-soft); }

.qty-input {
  width: 48px; padding: 7px; border-radius: 8px;
  border: 1px solid var(--c-parchment-border);
  background: rgba(255, 255, 255, 0.5);
  color: var(--c-parchment-ink);
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

/* Купить — фирменное золото (главное действие ряда); Продать — на порядок
   тише, обводка вместо заливки, чтобы их нельзя было спутать взглядом. */
.mini-btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, var(--c-gold-bright), var(--c-gold));
  color: #2c1c05;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.mini-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.mini-btn--flat {
  background: transparent;
  border: 1px solid var(--c-parchment-border);
  color: var(--c-parchment-ink-soft);
}

/* Up to 30 cannons on a Battleship — a grid, not a list, so that many
   still fits without scrolling forever. 3 columns keeps each card wide
   enough for the stat line to stay readable at the sheet's own max-width. */
.panel--gunsmith { padding: 0 8px; }
.cannon-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
.cannon-card {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 10px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.35);
  border: 1px solid var(--c-parchment-border);
  text-align: center;
}
.cannon-card--maxed { background: rgba(217, 164, 65, 0.16); border-color: rgba(217, 164, 65, 0.5); }
.cannon-card__icon { width: 22px; height: 22px; color: var(--c-parchment-ink-soft); margin-bottom: 2px; }
.cannon-card__title { font-weight: 700; font-size: 12.5px; color: var(--c-parchment-ink); }
.cannon-card__level { font-size: 11px; color: var(--c-parchment-ink-soft); font-variant-numeric: tabular-nums; }
.cannon-card__stats { font-size: 10px; color: var(--c-parchment-ink-soft); line-height: 1.3; margin: 2px 0 4px; }
.cannon-card__btn { width: 100%; padding: 7px 4px; font-size: 10.5px; }
.cannon-card__maxed-badge {
  width: 100%; padding: 7px 4px; border-radius: 8px;
  background: rgba(217, 164, 65, 0.25); color: var(--c-gold);
  font-size: 11px; font-weight: 700;
}

.leave-btn {
  position: absolute;
  left: 0;
  top: 0;
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* Keyboard/gamepad focus navigation (see useMenuNav) relies on this being
   visible. Plain :focus, not :focus-visible — a gamepad button press
   triggers focus via a plain JS .focus() call, and browsers don't
   consistently treat that as "should show the ring" the way a real
   keydown does, so :focus-visible could silently disappear on a gamepad. */
.port-modal :focus {
  outline: 3px solid var(--c-gold-bright);
  outline-offset: 2px;
}
</style>
