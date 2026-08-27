<template>
  <div v-if="shipInfo" class="info-panel" @click.self="$emit('close')">
    <div class="sheet">
      <button class="close-btn" @click="$emit('close')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>

      <div class="hero">
        <div class="hero__name">{{ shipInfo.name }}</div>
        <div class="hero__gold">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/></svg>
          {{ coins }}
        </div>
      </div>

      <div class="bar-row">
        <div class="bar-row__label">
          <span>HP</span>
          <span>{{ shipInfo.hp }}/{{ shipInfo.max_hp }}</span>
        </div>
        <div class="bar"><div class="bar__fill bar__fill--hp" :style="{ width: pct(shipInfo.hp, shipInfo.max_hp) }" /></div>
      </div>

      <div class="stat-grid">
        <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 L12 16 L6 16 Z"/><line x1="12" y1="3" x2="12" y2="18"/><path d="M4 18 Q12 22 20 18"/></svg><span class="stat__value">{{ shipInfo.speed }}</span><span class="stat__label">Скорость</span></div>
        <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"><path d="M12 3 L19 6 V11 C19 16 16 19.5 12 21 C8 19.5 5 16 5 11 V6 Z"/></svg><span class="stat__value">{{ shipInfo.protection }}</span><span class="stat__label">Броня</span></div>
        <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 9 C7 9 9 7 13 7"/><path d="M3 13 C8 13 12 15 17 15"/><path d="M3 17 C6 17 8 16 11 16"/></svg><span class="stat__value">{{ shipInfo.dodge }}%</span><span class="stat__label">Уворот</span></div>
        <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="14" height="7" rx="3"/><circle cx="19" cy="12.5" r="4"/></svg><span class="stat__value">{{ shipInfo.cannon_count }}</span><span class="stat__label">Пушек</span></div>
      </div>

      <div class="section">
        <div class="section__title">
          <span class="section__title-text">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="9" cy="9" r="3"/><circle cx="16" cy="10" r="3"/><path d="M4 20c0-3 2-5 5-5s5 2 5 5"/><path d="M12.2 20c0-2.6 1.7-4.6 3.8-4.6s3.8 2 3.8 4.6"/></svg>
            Экипаж
          </span>
          <span class="section__count">{{ shipInfo.sailor_count }}/{{ shipInfo.max_sailors }}</span>
        </div>
        <div v-if="sailorTypes.length === 0" class="empty">Никого не наняли</div>
        <div v-else class="chip-list">
          <div class="chip" v-for="type in sailorTypes" :key="type">
            <span class="chip__label">{{ SAILOR_NAMES[type] ?? type }}</span>
            <span class="chip__count">×{{ shipInfo.sailors[type] }}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section__title">
          <span class="section__title-text">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="16" y1="12" x2="21" y2="12"/><line x1="14.83" y1="14.83" x2="18.36" y2="18.36"/><line x1="12" y1="16" x2="12" y2="21"/><line x1="9.17" y1="14.83" x2="5.64" y2="18.36"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="9.17" y1="9.17" x2="5.64" y2="5.64"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="14.83" y1="9.17" x2="18.36" y2="5.64"/></svg>
            Капитан
          </span>
        </div>
        <div class="stat-grid stat-grid--captain">
          <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 L16 8"/><path d="M13 5 L19 11"/><circle cx="6" cy="18" r="1.6" fill="currentColor" stroke="none"/></svg><span class="stat__value">{{ shipInfo.captain.damage }}</span><span class="stat__label">Урон</span></div>
          <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"><path d="M12 3 L19 6 V11 C19 16 16 19.5 12 21 C8 19.5 5 16 5 11 V6 Z"/></svg><span class="stat__value">{{ shipInfo.captain.defense }}</span><span class="stat__label">Защита</span></div>
          <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><path d="M3 9 C7 9 9 7 13 7"/><path d="M3 13 C8 13 12 15 17 15"/><path d="M3 17 C6 17 8 16 11 16"/></svg><span class="stat__value">{{ shipInfo.captain.dodge }}%</span><span class="stat__label">Уворот</span></div>
          <div class="stat"><svg class="stat__icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/></svg><span class="stat__value">{{ shipInfo.captain.crit }}%</span><span class="stat__label">Крит</span></div>
        </div>
      </div>

      <div class="section">
        <div class="bar-row">
          <div class="bar-row__label">
            <span class="section__title-text">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="7" width="16" height="13" rx="1"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="12" y1="7" x2="12" y2="20"/></svg>
              Трюм
            </span>
            <span>{{ shipInfo.cargo_weight }}/{{ shipInfo.capacity }}</span>
          </div>
          <div class="bar"><div class="bar__fill bar__fill--cargo" :style="{ width: pct(shipInfo.cargo_weight, shipInfo.capacity) }" /></div>
        </div>
        <div v-if="productTypes.length === 0" class="empty">Пусто</div>
        <div v-else class="chip-list">
          <div class="chip" v-for="type in productTypes" :key="type">
            <svg class="chip__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" v-html="productIcon(type)"></svg>
            <span class="chip__label">{{ PRODUCT_NAMES[type] ?? type }}</span>
            <span class="chip__count">×{{ shipInfo.products[type] }} ({{ shipInfo.products[type] * (PRODUCT_WEIGHTS[type] ?? 0) }} веса)</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  shipInfo: { type: Object, default: null },
  coins: { type: Number, default: 0 },
})
defineEmits(['close'])

// Keep in sync with config/sailors.php's names.
const SAILOR_NAMES = { jung: 'Юнга', experienced: 'Опытный матрос', sea_wolf: 'Морской волк' }
// Keep in sync with config/products.php's names.
const PRODUCT_NAMES = {
  rum: 'Ром', silk: 'Шёлк', water: 'Вода', food: 'Еда',
  leather: 'Кожа', wood: 'Дерево', tobacco: 'Табак', coffee: 'Кофе',
}
// Keep in sync with config/products.php's weights — per-unit weight
// wasn't shown anywhere (here or the market), so "трюм почти полон" never
// explained WHY one stack of Кожа ate 10x the space a stack of Рома did.
const PRODUCT_WEIGHTS = { rum: 1, silk: 2, water: 1, food: 1, leather: 10, wood: 20, tobacco: 3, coffee: 7 }

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

const sailorTypes = computed(() => Object.keys(props.shipInfo?.sailors ?? {}).filter((t) => props.shipInfo.sailors[t] > 0))
const productTypes = computed(() => Object.keys(props.shipInfo?.products ?? {}).filter((t) => props.shipInfo.products[t] > 0))

function pct(value, max) {
  return `${Math.max(0, Math.min(100, Math.round((value / max) * 100)))}%`
}
</script>

<style scoped>
.info-panel {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(6, 12, 15, 0.6);
  padding: 16px;
}
.sheet {
  position: relative;
  width: min(380px, 100%);
  max-height: 85vh;
  overflow-y: auto;
  background: var(--c-bg-deep);
  border: 1px solid var(--c-border);
  border-radius: 16px;
  padding: 22px 20px 20px;
  color: var(--c-ink);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
}

.close-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--c-ink-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.close-btn:hover { background: rgba(255, 255, 255, 0.16); }

.hero { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; padding-right: 30px; }
.hero__name { font-family: var(--font-display); font-size: 19px; letter-spacing: 0.01em; }
.hero__gold { display: flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 700; color: var(--c-gold-bright); white-space: nowrap; font-variant-numeric: tabular-nums; }

.bar-row { margin-bottom: 16px; }
.bar-row__label { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--c-ink-soft); margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.06em; }
.bar { height: 8px; border-radius: 5px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.bar__fill { height: 100%; border-radius: 5px; transition: width 0.2s; }
.bar__fill--hp { background: linear-gradient(90deg, var(--c-gold), var(--c-success)); }
.bar__fill--cargo { background: linear-gradient(90deg, var(--c-gold), var(--c-gold-bright)); }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 18px; }
.stat {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 10px 4px; border-radius: 10px; background: var(--c-surface);
}
.stat__icon { width: 17px; height: 17px; color: var(--c-gold-bright); }
.stat__value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat__label { font-size: 10px; color: var(--c-ink-soft); text-transform: uppercase; letter-spacing: 0.03em; }

.section { margin-bottom: 18px; }
.section:last-child { margin-bottom: 0; }
.section__title {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--c-ink-soft); margin-bottom: 8px;
}
.section__title-text { display: flex; align-items: center; gap: 6px; }
.section__count { font-variant-numeric: tabular-nums; color: var(--c-ink); }

.empty { font-size: 13px; color: var(--c-ink-faint); font-style: italic; }

.chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 999px;
  background: var(--c-surface); border: 1px solid var(--c-border);
  font-size: 12px;
}
.chip__icon { width: 13px; height: 13px; color: var(--c-ink-soft); flex: none; }
.chip__label { color: var(--c-ink); }
.chip__count { color: var(--c-ink-soft); font-variant-numeric: tabular-nums; }
</style>
