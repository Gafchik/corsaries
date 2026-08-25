<template>
  <q-page class="abordage-page">
    <div v-if="loading" class="text-center q-mt-xl">Готовимся к абордажу...</div>

    <div v-else-if="abordage" ref="pageRef" class="sheet">
      <div class="hero">
        <div class="hero__title">Абордаж{{ opponentName ? ` — ${opponentName}` : '' }}</div>
      </div>

      <div class="hp-bars">
        <div class="hp-bar">
          <div class="hp-bar__label">Ты — {{ abordage.a_hp !== undefined ? sideHp('a') : sideHp('me') }} / {{ sideMaxHp('me') }}</div>
          <div class="hp-bar__track"><div class="hp-bar__fill" :style="{ width: pct(sideHp('me'), sideMaxHp('me')) }" /></div>
          <div class="hp-bar__stats">
            Урон {{ sideStats('me').damage }} · Защита {{ sideStats('me').defense }} ·
            Уворот {{ sideStats('me').dodge }}% · Крит {{ sideStats('me').crit }}%
          </div>
        </div>
        <div class="hp-bar">
          <div class="hp-bar__label">Противник — {{ sideHp('opponent') }} / {{ sideMaxHp('opponent') }}</div>
          <div class="hp-bar__track"><div class="hp-bar__fill hp-bar__fill--enemy" :style="{ width: pct(sideHp('opponent'), sideMaxHp('opponent')) }" /></div>
          <div class="hp-bar__stats">
            Урон {{ sideStats('opponent').damage }} · Защита {{ sideStats('opponent').defense }} ·
            Уворот {{ sideStats('opponent').dodge }}% · Крит {{ sideStats('opponent').crit }}%
          </div>
        </div>
      </div>

      <div v-if="abordage.status === 'completed'" class="result">
        <div class="result__title">{{ resultText }}</div>
        <div v-if="sideCrew('me').before != null" class="result__crew">
          Экипаж: {{ sideCrew('me').before }} → {{ sideCrew('me').after }}
          <span v-if="sideCrew('me').after < sideCrew('me').before" class="result__crew-loss">
            (−{{ sideCrew('me').before - sideCrew('me').after }})
          </span>
        </div>
        <div v-if="sideCrew('opponent').before != null" class="result__crew result__crew--enemy">
          Экипаж противника: {{ sideCrew('opponent').before }} → {{ sideCrew('opponent').after }}
        </div>
        <div v-if="abordage.loot_gold" class="result__loot">Добыча: +{{ abordage.loot_gold }} золота</div>
        <button
          v-if="iWon && abordage.loot_offer_id"
          class="loot-btn"
          @click="$router.push(`/loot/${abordage.loot_offer_id}`)"
        >
          Забрать груз с трюма
        </button>
        <button class="leave-btn" @click="$router.push('/world')">Уплыть</button>
      </div>

      <div v-else-if="waitingForOpponent" class="waiting">
        <div class="waiting__text">Ход сделан — ждём соперника...</div>
      </div>

      <template v-else>
        <div class="picker">
          <div class="picker__label">Куда бить</div>
          <div class="zones">
            <button v-for="z in zones" :key="'a-'+z" class="zone-btn" :class="{ active: attack === z }" @click="attack = z">
              {{ zoneLabel(z) }}
            </button>
          </div>

          <div class="picker__label">Что защищать (2 зоны)</div>
          <div class="zones">
            <button
              v-for="z in zones" :key="'d-'+z" class="zone-btn"
              :class="{ active: defend.includes(z) }"
              @click="toggleDefend(z)"
            >
              {{ zoneLabel(z) }}
            </button>
          </div>
        </div>

        <p v-if="error" class="error-text">{{ error }}</p>

        <button class="submit-btn" :disabled="!attack || defend.length !== 2 || submitting" @click="submit">
          {{ submitting ? 'Бьёмся...' : 'Атаковать' }}
        </button>
      </template>

      <div v-if="roundsDisplay.length > 0" class="log">
        <div class="log__title">Журнал боя</div>
        <div v-for="r in roundsDisplay" :key="r.round" class="round-entry">
          <div class="round-entry__title">Раунд {{ r.round }}</div>

          <div class="fighter-row fighter-row--you">
            <div class="fighter-row__head">
              <span class="fighter-row__name">Ты</span>
              <span class="fighter-row__hp">{{ r.you.hpAfter }} HP</span>
            </div>
            <div v-if="r.you.moved" class="fighter-row__moves">
              <span class="move-chip">Атака: {{ zoneLabel(r.you.attack) }}</span>
              <span class="move-chip">Защита: {{ r.you.defend.map(zoneLabel).join(', ') }}</span>
            </div>
            <div v-else class="fighter-row__idle">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" v-html="resultIcon('idle')"></svg>
              Не успел(а) сходить
            </div>
            <div class="fighter-row__result" :class="`fighter-row__result--${r.you.result.tone}`">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" v-html="resultIcon(r.you.result.tone)"></svg>
              {{ r.you.result.text }}
            </div>
          </div>

          <div class="fighter-row fighter-row--opp">
            <div class="fighter-row__head">
              <span class="fighter-row__name">{{ opponentName || 'Противник' }}</span>
              <span class="fighter-row__hp">{{ r.opp.hpAfter }} HP</span>
            </div>
            <div v-if="r.opp.moved" class="fighter-row__moves">
              <span class="move-chip">Атака: {{ zoneLabel(r.opp.attack) }}</span>
              <span class="move-chip">Защита: {{ r.opp.defend.map(zoneLabel).join(', ') }}</span>
            </div>
            <div v-else class="fighter-row__idle">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" v-html="resultIcon('idle')"></svg>
              Не успел(а) сходить
            </div>
            <div class="fighter-row__result" :class="`fighter-row__result--${r.opp.result.tone}`">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" v-html="resultIcon(r.opp.result.tone)"></svg>
              {{ r.opp.result.text }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </q-page>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '@/services/api'
import { controls } from '@/services/controls'
import { useMenuNav } from '@/composables/useMenuNav'

const route = useRoute()
const router = useRouter()
const existingId = route.params.id
const botShipType = route.query.botShipType
const botName = route.query.botName
const pageRef = ref(null)

const loading = ref(true)
const error = ref('')
const submitting = ref(false)
const abordage = ref(null)
const rounds = ref([])
let pollTimer = null

const zones = ['head', 'chest', 'groin', 'legs']
const zoneNames = { head: 'Голова', chest: 'Грудь', groin: 'Пах', legs: 'Ноги' }
const zoneLabel = (z) => zoneNames[z]

// Раунд-лог раньше отмечал исход эмодзи (🛡️💨💥😴) — тот же набор
// стро́ковых иконок, что и везде в интерфейсе, по тону исхода.
const RESULT_ICONS = {
  block: '<path d="M12 3 L19 6 V11 C19 16 16 19.5 12 21 C8 19.5 5 16 5 11 V6 Z"/>',
  dodge: '<path d="M3 9 C7 9 9 7 13 7"/><path d="M3 13 C8 13 12 15 17 15"/><path d="M3 17 C6 17 8 16 11 16"/>',
  hit: '<path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/>',
  idle: '<circle cx="12" cy="12" r="9"/><path d="M12 7 v5 l3 3"/>',
}
function resultIcon(tone) {
  return RESULT_ICONS[tone] ?? RESULT_ICONS.idle
}

const attack = ref(null)
const defend = ref([])

// PvE has no `your_side` (always plays as 'a'); PvP does, and it can be
// either side depending on who challenged whom.
const mySide = computed(() => abordage.value?.your_side ?? 'a')
const opponentSide = computed(() => (mySide.value === 'a' ? 'b' : 'a'))
const opponentName = computed(() => abordage.value?.opponent?.first_name ?? botName)
const waitingForOpponent = computed(() => abordage.value?.mode === 'pvp' && abordage.value?.my_pending_submitted)

function sideHp(who) {
  const side = who === 'me' ? mySide.value : who === 'opponent' ? opponentSide.value : who
  return abordage.value?.[`${side}_hp`]
}
function sideMaxHp(who) {
  const side = who === 'me' ? mySide.value : who === 'opponent' ? opponentSide.value : who
  return abordage.value?.[`${side}_max_hp`]
}
// Captain stats from hired sailors (see Ship::captainStats server-side) —
// snapshotted for this fight, so they won't shift mid-round even if the
// player visits a tavern in another tab.
function sideStats(who) {
  const side = who === 'me' ? mySide.value : who === 'opponent' ? opponentSide.value : who
  return {
    damage: abordage.value?.[`${side}_damage`],
    defense: abordage.value?.[`${side}_defense`],
    dodge: abordage.value?.[`${side}_dodge`],
    crit: abordage.value?.[`${side}_crit`],
  }
}

// Null until the fight actually ends (see Ship::applyCasualties server-side)
// — and stays null forever for a PvE bot, which has no real crew to lose.
function sideCrew(who) {
  const side = who === 'me' ? mySide.value : who === 'opponent' ? opponentSide.value : who
  return { before: abordage.value?.[`${side}_crew_before`], after: abordage.value?.[`${side}_crew_after`] }
}

// Structured round-by-round log (ported from battle-arena's RoundLogEntry,
// restyled for our dark theme) — a per-round card split into "you" and
// "opponent" outcomes, instead of one flat pre-formatted text blob.
function outcomeFor(round, mine, theirsLabel) {
  const theirs = mine === 'a' ? 'b' : 'a'
  const myAttack = round[`${mine}_attack`]
  const myDefend = round[`${mine}_defend`] || []
  const theirAttack = round[`${theirs}_attack`]
  const damageTaken = round[`${mine}_damage`]
  const wasBlocked = round[`${mine}_blocked`]
  const hpAfter = round[`${mine}_hp_after`]

  let result
  if (theirAttack === null) {
    result = { text: `${theirsLabel} не успел(а) сходить`, tone: 'idle' }
  } else if (wasBlocked) {
    result = { text: `Заблокировал(а) — −${damageTaken} HP`, tone: 'block' }
  } else if (damageTaken === 0) {
    // No stored 'dodged' flag — a landed attack (theirAttack isn't null)
    // that wasn't blocked and did 0 damage can only be a dodge, see
    // BattleEngine::rollAttack.
    result = { text: 'Уворот!', tone: 'dodge' }
  } else {
    result = { text: `Получил(а) удар — −${damageTaken} HP`, tone: 'hit' }
  }

  return { moved: myAttack !== null, attack: myAttack, defend: myDefend, hpAfter, result }
}

const roundsDisplay = computed(() => [...rounds.value].reverse().map((r) => ({
  round: r.round,
  you: outcomeFor(r, mySide.value, opponentName.value || 'Противник'),
  opp: outcomeFor(r, opponentSide.value, 'Ты'),
})))

const iWon = computed(() => abordage.value?.winner === mySide.value)

const resultText = computed(() => {
  if (iWon.value) return 'Победа! Противник повержен.'
  if (abordage.value?.winner === opponentSide.value) return 'Поражение... капитан ранен.'
  return 'Ничья — оба капитана без сил.'
})

function pct(hp, maxHp) {
  return `${Math.max(0, Math.round((hp / maxHp) * 100))}%`
}

function toggleDefend(z) {
  if (defend.value.includes(z)) {
    defend.value = defend.value.filter((x) => x !== z)
  } else if (defend.value.length < 2) {
    defend.value = [...defend.value, z]
  }
}

async function submit() {
  error.value = ''
  submitting.value = true
  try {
    await api.submitAbordageMove(abordage.value.id, attack.value, defend.value)
    attack.value = null
    defend.value = []
    // A fresh full re-fetch rather than merging the move response in place —
    // PvE's response includes the new round, PvP's doesn't (it resolves
    // once both sides have moved, which might not be yet), so refresh()
    // is the one path that's correct for both.
    await refresh()
    startPollingIfWaiting()
  } catch (e) {
    error.value = e.message || 'Что-то пошло не так'
  } finally {
    submitting.value = false
  }
}

async function refresh() {
  const data = await api.getAbordage(abordage.value.id)
  abordage.value = data.abordage
  rounds.value = data.rounds
  if (!waitingForOpponent.value || abordage.value.status === 'completed') stopPolling()
}

function startPollingIfWaiting() {
  if (waitingForOpponent.value && !pollTimer) {
    pollTimer = setInterval(() => refresh().catch(() => {}), 2000)
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(async () => {
  try {
    if (existingId) {
      const data = await api.getAbordage(existingId)
      abordage.value = data.abordage
      rounds.value = data.rounds
      startPollingIfWaiting()
    } else {
      const data = await api.startAbordagePve(botShipType)
      abordage.value = data.abordage
    }
  } catch (e) {
    error.value = e.message || 'Не удалось начать абордаж'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => stopPolling())

// Dedicated shortcut (gamepad Circle/B, or Escape) — same destination as
// "Уплыть". Works mid-fight too: an in-progress abordage (especially PvP)
// is resumable at /abordage/:id, leaving isn't a forfeit.
const unsubBack = controls.onPress('back', () => router.push('/world'))
onBeforeUnmount(() => unsubBack())

// Up/down + action navigates the zone pickers and result buttons with a
// keyboard or a gamepad. Re-scans whenever which buttons are even on
// screen changes (waiting for the opponent, fight resolved, a move being
// submitted disables the submit button, ...).
const { refreshItems } = useMenuNav(pageRef, {
  watchSource: () => [abordage.value?.status, waitingForOpponent.value, submitting.value],
})
// Picking a zone doesn't change which buttons are focusable, only which
// one has the .active class — but attack/defend picks happen fast enough
// (before the next watchSource tick) that a stale disabled-state on the
// submit button could otherwise get skipped. Cheap to just always re-sync.
// nextTick, not a bare call — the DOM hasn't actually dropped "Атаковать"'s
// disabled attribute yet at the moment this watch callback runs (Vue's
// default 'pre' flush timing runs watchers before the re-render), so
// scanning immediately would still see it as disabled and skip it —
// exactly the bug where the submit button was unreachable by controller.
watch([attack, defend], () => nextTick(refreshItems), { deep: true })
</script>

<style scoped>
.abordage-page {
  min-height: 100vh;
  background: radial-gradient(140% 70% at 50% -10%, var(--c-bg-mid) 0%, var(--c-bg-deep) 60%), var(--c-bg-deep);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
.text-center.q-mt-xl { color: var(--c-ink-soft); }

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

.hero { text-align: center; margin-bottom: 18px; }
.hero__title { font-family: var(--font-display); font-size: 21px; letter-spacing: 0.01em; }

.hp-bars { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
.hp-bar__label { font-size: 13px; font-weight: 700; margin-bottom: 5px; }
.hp-bar__track { height: 10px; border-radius: 6px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.hp-bar__fill { height: 100%; border-radius: 6px; background: linear-gradient(90deg, var(--c-gold), var(--c-success)); transition: width 0.2s; }
.hp-bar__fill--enemy { background: linear-gradient(90deg, #a3392f, var(--c-danger)); }
.hp-bar__stats { font-size: 11px; color: var(--c-ink-soft); margin-top: 4px; }

.picker__label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-ink-soft); margin: 16px 0 8px; }
.zones { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.zone-btn {
  padding: 12px 4px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.zone-btn.active { background: rgba(217, 164, 65, 0.16); border-color: rgba(217, 164, 65, 0.45); color: var(--c-gold-bright); }

.error-text { color: var(--c-danger); font-size: 13px; margin-top: 8px; }

.waiting { text-align: center; margin-top: 28px; }
.waiting__text { font-size: 14px; color: var(--c-ink-soft); }

.submit-btn {
  width: 100%;
  margin-top: 20px;
  padding: 13px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #c96b60, var(--c-danger));
  color: #fff;
  font-weight: 700;
  cursor: pointer;
}
.submit-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* Round-by-round log — structure lifted from battle-arena's
   RoundLogEntry.vue, recolored for our nautical palette (gold = you,
   danger red = opponent, same as the HP bars above). */
.log { margin-top: 20px; }
.log__title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--c-ink-soft); margin-bottom: 10px; }

.round-entry { padding: 12px 0; border-top: 1px solid var(--c-border); }
.round-entry:first-child { border-top: none; padding-top: 0; }
.round-entry__title { font-weight: 700; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--c-ink-faint); margin-bottom: 8px; }

.fighter-row {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(217, 164, 65, 0.08);
  border: 1px solid rgba(217, 164, 65, 0.18);
  margin-bottom: 8px;
}
.fighter-row--opp {
  background: rgba(226, 104, 94, 0.08);
  border-color: rgba(226, 104, 94, 0.18);
  margin-bottom: 0;
}

.fighter-row__head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
.fighter-row__name { font-weight: 700; font-size: 13px; }
.fighter-row--you .fighter-row__name { color: var(--c-gold-bright); }
.fighter-row--opp .fighter-row__name { color: var(--c-danger); }
.fighter-row__hp { font-size: 11px; color: var(--c-ink-soft); font-weight: 600; font-variant-numeric: tabular-nums; }

.fighter-row__moves { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-bottom: 5px; }
.move-chip { font-size: 12px; color: var(--c-ink-soft); }

.fighter-row__idle { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--c-ink-faint); margin-bottom: 5px; font-style: italic; }

.fighter-row__result { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; }
.fighter-row__result svg { flex: none; }
.fighter-row__result--idle { color: var(--c-ink-faint); font-weight: 600; }
.fighter-row__result--block { color: var(--c-gold-bright); }
.fighter-row__result--dodge { color: #7fd4e0; }
.fighter-row__result--hit { color: #ff9d94; }

.result { text-align: center; margin-top: 28px; }
.result__title { font-family: var(--font-display); font-size: 20px; margin-bottom: 6px; }
.result__loot { font-size: 14px; color: var(--c-gold-bright); font-weight: 700; margin-bottom: 16px; }
.result__crew { font-size: 13px; color: var(--c-ink-soft); margin-bottom: 4px; }
.result__crew--enemy { margin-bottom: 12px; }
.result__crew-loss { color: var(--c-danger); font-weight: 700; }

.leave-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid var(--c-border);
  background: transparent;
  color: var(--c-ink);
  font-weight: 700;
  cursor: pointer;
}
.loot-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, var(--c-gold-bright), var(--c-gold));
  color: #2c1c05;
  font-weight: 700;
  cursor: pointer;
  margin-bottom: 10px;
}

/* Plain :focus, not :focus-visible — see the same note in PortPage.vue. */
.abordage-page :focus {
  outline: 3px solid var(--c-gold-bright);
  outline-offset: 2px;
}
</style>
