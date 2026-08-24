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
  background: linear-gradient(180deg, #1a2c32 0%, #142127 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.text-center.q-mt-xl { color: #9fc2ba; }

.sheet {
  width: min(420px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  background: linear-gradient(180deg, #1a2c32 0%, #142127 100%);
  border: 1px solid #2c4046;
  border-radius: 16px;
  padding: 22px 20px;
  color: #eef5f3;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}

.hero { text-align: center; margin-bottom: 18px; }
.hero__title { font-size: 19px; font-weight: 800; }
.hero__sub { font-size: 13px; color: #9fc2ba; margin-top: 4px; }

.empty { text-align: center; color: #9fc2ba; font-style: italic; margin-top: 24px; }

.items { display: flex; flex-direction: column; gap: 8px; }
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

.stepper { display: flex; align-items: center; gap: 10px; }
.step-btn {
  width: 30px; height: 30px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: #eef5f3;
  font-size: 16px;
  cursor: pointer;
}
.step-value { min-width: 20px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }

.error-text { color: #ff8080; font-size: 13px; margin-top: 8px; }

.actions { display: flex; gap: 8px; margin-top: 16px; }
.mini-btn {
  flex: 1;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.mini-btn--flat { background: rgba(255, 255, 255, 0.06); color: #eef5f3; }

.submit-btn {
  width: 100%;
  margin-top: 14px;
  padding: 13px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #c98a3f, #a5691b);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.submit-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* Plain :focus, not :focus-visible — see the same note in PortPage.vue. */
.loot-page :focus {
  outline: 3px solid #6fd98a;
  outline-offset: 2px;
}
</style>
