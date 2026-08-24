<template>
  <div v-if="shipInfo" class="info-panel" @click.self="$emit('close')">
    <div class="sheet">
      <button class="close-btn" @click="$emit('close')">✕</button>

      <div class="hero">
        <div class="hero__name">{{ shipInfo.name }}</div>
        <div class="hero__gold">💰 {{ coins }}</div>
      </div>

      <div class="bar-row">
        <div class="bar-row__label">
          <span>HP</span>
          <span>{{ shipInfo.hp }}/{{ shipInfo.max_hp }}</span>
        </div>
        <div class="bar"><div class="bar__fill bar__fill--hp" :style="{ width: pct(shipInfo.hp, shipInfo.max_hp) }" /></div>
      </div>

      <div class="stat-grid">
        <div class="stat"><span class="stat__icon">⛵</span><span class="stat__value">{{ shipInfo.speed }}</span><span class="stat__label">Скорость</span></div>
        <div class="stat"><span class="stat__icon">🛡️</span><span class="stat__value">{{ shipInfo.protection }}</span><span class="stat__label">Броня</span></div>
        <div class="stat"><span class="stat__icon">💨</span><span class="stat__value">{{ shipInfo.dodge }}%</span><span class="stat__label">Уворот</span></div>
        <div class="stat"><span class="stat__icon">💣</span><span class="stat__value">{{ shipInfo.cannon_count }}</span><span class="stat__label">Пушек</span></div>
      </div>

      <div class="section">
        <div class="section__title">
          <span>Экипаж</span>
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
        <div class="section__title"><span>Капитан</span></div>
        <div class="stat-grid stat-grid--captain">
          <div class="stat"><span class="stat__icon">⚔️</span><span class="stat__value">{{ shipInfo.captain.damage }}</span><span class="stat__label">Урон</span></div>
          <div class="stat"><span class="stat__icon">🛡️</span><span class="stat__value">{{ shipInfo.captain.defense }}</span><span class="stat__label">Защита</span></div>
          <div class="stat"><span class="stat__icon">💨</span><span class="stat__value">{{ shipInfo.captain.dodge }}%</span><span class="stat__label">Уворот</span></div>
          <div class="stat"><span class="stat__icon">✨</span><span class="stat__value">{{ shipInfo.captain.crit }}%</span><span class="stat__label">Крит</span></div>
        </div>
      </div>

      <div class="section">
        <div class="bar-row">
          <div class="bar-row__label">
            <span>Трюм</span>
            <span>{{ shipInfo.cargo_weight }}/{{ shipInfo.capacity }}</span>
          </div>
          <div class="bar"><div class="bar__fill bar__fill--cargo" :style="{ width: pct(shipInfo.cargo_weight, shipInfo.capacity) }" /></div>
        </div>
        <div v-if="productTypes.length === 0" class="empty">Пусто</div>
        <div v-else class="chip-list">
          <div class="chip" v-for="type in productTypes" :key="type">
            <span class="chip__label">{{ PRODUCT_NAMES[type] ?? type }}</span>
            <span class="chip__count">{{ shipInfo.products[type] }}</span>
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
  background: rgba(8, 16, 21, 0.6);
  padding: 16px;
}
.sheet {
  position: relative;
  width: min(380px, 100%);
  max-height: 85vh;
  overflow-y: auto;
  background: linear-gradient(180deg, #1a2c32 0%, #142127 100%);
  border: 1px solid #2c4046;
  border-radius: 16px;
  padding: 22px 20px 20px;
  color: #eef5f3;
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
  color: #bcd9d1;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.close-btn:hover { background: rgba(255, 255, 255, 0.16); }

.hero { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; padding-right: 30px; }
.hero__name { font-size: 20px; font-weight: 800; letter-spacing: 0.01em; }
.hero__gold { font-size: 14px; font-weight: 700; color: #ffd166; white-space: nowrap; }

.bar-row { margin-bottom: 16px; }
.bar-row__label { display: flex; justify-content: space-between; font-size: 12px; color: #9fc2ba; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.06em; }
.bar { height: 8px; border-radius: 5px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.bar__fill { height: 100%; border-radius: 5px; transition: width 0.2s; }
.bar__fill--hp { background: linear-gradient(90deg, #3fae66, #6fd98a); }
.bar__fill--cargo { background: linear-gradient(90deg, #c98a3f, #e0b06a); }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 18px; }
.stat {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 10px 4px; border-radius: 10px; background: rgba(255, 255, 255, 0.05);
}
.stat__icon { font-size: 16px; line-height: 1; }
.stat__value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat__label { font-size: 10px; color: #9fc2ba; text-transform: uppercase; letter-spacing: 0.03em; }

.section { margin-bottom: 18px; }
.section:last-child { margin-bottom: 0; }
.section__title {
  display: flex; justify-content: space-between; align-items: baseline;
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: #9fc2ba; margin-bottom: 8px;
}
.section__count { font-variant-numeric: tabular-nums; color: #eef5f3; }

.empty { font-size: 13px; color: #6f8b85; font-style: italic; }

.chip-list { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 999px;
  background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}
.chip__label { color: #eef5f3; }
.chip__count { color: #9fc2ba; font-variant-numeric: tabular-nums; }
</style>
