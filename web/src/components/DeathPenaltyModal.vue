<template>
  <div v-if="summary" class="death-modal" @click.self="$emit('close')">
    <div class="sheet">
      <div class="hero">
        <svg class="hero__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8v8l9 5 9-5V8z" opacity="0.35"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none"/></svg>
        <div class="hero__title">Корабль потоплен</div>
      </div>

      <div v-if="lines.length === 0" class="empty">Трюм и казна были пусты — терять оказалось нечего.</div>
      <div v-else class="loss-list">
        <div class="loss-row" v-for="line in lines" :key="line.label">
          <span class="loss-row__label">{{ line.label }}</span>
          <span class="loss-row__value">−{{ line.value }}</span>
        </div>
      </div>

      <button class="ok-btn" @click="$emit('close')">Понял</button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// summary: { lostGold, lostProducts, lostSailors } — see the 'death_penalty'
// handler in WorldPage.vue, sent once WorldRoom's applyDeathPenalty (a real
// DB round-trip, see db.js) confirms the exact numbers actually lost.
const props = defineProps({
  summary: { type: Object, default: null },
})
defineEmits(['close'])

// Keep in sync with config/products.php's names — same table
// ShipInfoOverlay.vue keeps its own copy of, not shared, since neither
// component depends on the other existing.
const PRODUCT_NAMES = {
  rum: 'Ром', silk: 'Шёлк', water: 'Вода', food: 'Еда',
  leather: 'Кожа', wood: 'Дерево', tobacco: 'Табак', coffee: 'Кофе',
}

const lines = computed(() => {
  if (!props.summary) return []
  const out = []
  if (props.summary.lostGold > 0) out.push({ label: 'Золото', value: props.summary.lostGold })
  for (const [type, qty] of Object.entries(props.summary.lostProducts || {})) {
    if (qty > 0) out.push({ label: PRODUCT_NAMES[type] ?? type, value: qty })
  }
  if (props.summary.lostSailors > 0) out.push({ label: 'Матросы', value: props.summary.lostSailors })
  return out
})
</script>

<style scoped>
/* Same fixed-overlay pattern as ShipInfoOverlay/PortModal — see either of
   their own comments for why position:fixed specifically (an absolute
   overlay can drift with ancestor scroll a mobile keyboard leaves stuck). */
.death-modal {
  position: fixed;
  inset: 0;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 12, 15, 0.68);
  padding: 16px;
}
.sheet {
  width: min(340px, 100%);
  background: var(--c-bg-deep);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  padding: 22px 20px 20px;
  color: var(--c-ink);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}

.hero { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 18px; text-align: center; }
.hero__icon { width: 40px; height: 40px; color: #ff9d94; }
.hero__title { font-family: var(--font-display); font-size: 18px; letter-spacing: 0.01em; }

.empty { font-size: 13px; color: var(--c-ink-faint); font-style: italic; text-align: center; margin-bottom: 18px; }

.loss-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
.loss-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 9px 12px; border-radius: 10px; background: var(--c-surface);
  font-size: 14px;
}
.loss-row__label { color: var(--c-ink-soft); }
.loss-row__value { color: #ff9d94; font-weight: 700; font-variant-numeric: tabular-nums; }

.ok-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: var(--c-gold);
  color: #1a1410;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
}
</style>
