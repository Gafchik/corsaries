<template>
  <q-page class="loot-page">
    <div v-if="loading" class="text-center q-mt-xl">Осматриваем обломки...</div>

    <div v-else-if="offer" ref="pageRef" class="sheet">
      <div class="hero">
        <div class="hero__title">Добыча с потопленного корабля</div>
        <div class="hero__sub">Трюм: {{ usedWeight }} / {{ ship.capacity }}</div>
      </div>

      <div v-if="offer.items.length === 0" class="empty">На месте крушения ничего не уцелело.</div>

      <div v-else class="items">
        <div v-for="item in offer.items" :key="item.type" class="row">
          <div class="row__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" v-html="productIcon(item.type)"></svg></div>
          <div class="row__main">
            <div class="row__title">{{ item.name }}</div>
            <div class="row__sub">уцелело: {{ item.available }} (вес {{ item.weight }} каждая)</div>
          </div>
          <div class="stepper">
            <button class="step-btn" @click="dec(item)">−</button>
            <span class="step-value">{{ chosen[item.type] }}</span>
            <button class="step-btn" @click="inc(item)">+</button>
          </div>
        </div>
      </div>

      <p v-if="error" class="error-text">{{ error }}</p>

      <div class="actions">
        <button class="mini-btn mini-btn--flat" @click="takeAll">Собрать всё</button>
        <button class="mini-btn mini-btn--flat" @click="takeNone">Сбросить всё за борт</button>
      </div>

      <button class="submit-btn" :disabled="submitting" @click="submit">
        {{ submitting ? 'Грузим...' : 'Погрузить в трюм' }}
      </button>
    </div>
  </q-page>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { controls } from '@/services/controls'
import { useMenuNav } from '@/composables/useMenuNav'

const route = useRoute()
const router = useRouter()
const offerId = route.params.id
const pageRef = ref(null)

const loading = ref(true)
const submitting = ref(false)
const error = ref('')
const offer = ref(null)
const ship = ref(null)
const chosen = reactive({})

// Тот же набор пиктограмм товаров, что и на рынке в порту (см. api/config/products.php).
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

const usedWeight = computed(() => {
  if (!offer.value) return 0
  const added = offer.value.items.reduce((sum, item) => sum + (chosen[item.type] || 0) * item.weight, 0)
  return ship.value.cargo_weight + added
})

function inc(item) {
  const nextQty = (chosen[item.type] || 0) + 1
  if (nextQty > item.available) return
  if (usedWeight.value + item.weight > ship.value.capacity) return
  chosen[item.type] = nextQty
}

function dec(item) {
  chosen[item.type] = Math.max(0, (chosen[item.type] || 0) - 1)
}

function takeAll() {
  for (const item of offer.value.items) {
    let qty = 0
    while (qty < item.available && ship.value.cargo_weight + freeAddedWeight() + item.weight <= ship.value.capacity) {
      qty++
      chosen[item.type] = qty
    }
  }
}

function freeAddedWeight() {
  return offer.value.items.reduce((sum, item) => sum + (chosen[item.type] || 0) * item.weight, 0)
}

function takeNone() {
  for (const item of offer.value.items) chosen[item.type] = 0
}

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await api.claimLoot(offerId, { ...chosen })
    router.push('/world')
  } catch (e) {
    error.value = e.message || 'Что-то пошло не так'
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  try {
    const data = await api.getLootOffer(offerId)
    offer.value = data.offer
    ship.value = data.ship
    for (const item of data.offer.items) chosen[item.type] = 0
  } catch (e) {
    error.value = e.message || 'Не удалось загрузить добычу'
  } finally {
    loading.value = false
  }
})

// Dedicated shortcut back to the world (gamepad Circle/B, or Escape) —
// leaving without claiming just abandons the offer, same as always.
const unsubBack = controls.onPress('back', () => router.push('/world'))
onBeforeUnmount(() => unsubBack())

// Up/down + action navigates the item steppers and action buttons with a
// keyboard or a gamepad — same composable as everywhere else. Re-scans
// whenever the submit button's disabled state could've changed.
const { refreshItems } = useMenuNav(pageRef, { watchSource: () => [loading.value, submitting.value] })
</script>

<style scoped>
.loot-page {
  min-height: 100vh;
  background: radial-gradient(140% 70% at 50% -10%, var(--c-bg-mid) 0%, var(--c-bg-deep) 60%), var(--c-bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.text-center.q-mt-xl { color: var(--c-ink-soft); }

.sheet {
  width: min(420px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  background: var(--c-bg-deep);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  padding: 22px 20px;
  color: var(--c-ink);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}

.hero { text-align: center; margin-bottom: 18px; }
.hero__title { font-family: var(--font-display); font-size: 21px; letter-spacing: 0.01em; }
.hero__sub { font-size: 13px; color: var(--c-ink-soft); margin-top: 4px; }

.empty { text-align: center; color: var(--c-ink-soft); font-style: italic; margin-top: 24px; }

.items { display: flex; flex-direction: column; gap: 8px; }
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--c-border);
  border-radius: 12px;
  background: var(--c-surface);
}
.row__icon {
  flex: none; width: 32px; height: 32px; border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  display: flex; align-items: center; justify-content: center;
  color: var(--c-ink-soft);
}
.row__icon svg { width: 17px; height: 17px; }
.row__main { flex: 1; min-width: 0; }
.row__title { font-weight: 700; font-size: 14px; }
.row__sub { font-size: 12px; color: var(--c-ink-soft); }

.stepper { display: flex; align-items: center; gap: 10px; }
.step-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: 16px;
  cursor: pointer;
}
.step-value { min-width: 20px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }

.error-text { color: var(--c-danger); font-size: 13px; margin-top: 8px; }

.actions { display: flex; gap: 8px; margin-top: 16px; }
.mini-btn {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.mini-btn--flat { background: var(--c-surface); color: var(--c-ink); }

.submit-btn {
  width: 100%;
  margin-top: 14px;
  padding: 13px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, var(--c-gold-bright), var(--c-gold));
  color: #2c1c05;
  font-weight: 700;
  cursor: pointer;
}
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Plain :focus, not :focus-visible — see the same note in PortPage.vue. */
.loot-page :focus {
  outline: 3px solid var(--c-gold-bright);
  outline-offset: 2px;
}
</style>
