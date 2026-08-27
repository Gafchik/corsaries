<template>
  <q-page class="world-page">
    <!--
      Everything lives inside this capped, centered frame instead of directly
      in .world-page — on a small phone screen the frame just fills 100% (no
      visible change), but on an oversized desktop window it stays a
      reasonable game-sized box instead of stretching edge to edge, which is
      what made "Войти в порт" (bottom-anchored, like any HUD prompt) end up
      looking abandoned far below the ship (always screen-centered by the
      camera) on a tall monitor. Phaser's RESIZE mode (see the Game config
      below) already tracks whatever size .world-canvas actually renders at,
      so capping this frame is all resizing the game area itself needs.
    -->
    <div class="world-frame">
      <div ref="container" class="world-canvas"></div>
      <!--
        A slim top-center notice instead of a big button pinned to an edge —
        the old version sat at a fixed bottom offset, which put it right in
        the ship's face on a phone but stranded and disconnected-looking on
        a tall desktop window (the ship itself is always screen-centered by
        the camera, an edge never is). Tapping it still works for a
        mouse/touch user, but the real point is that Действие (keyboard F,
        gamepad A, the touch button) already does the same thing — this is
        just telling you it's available, not the only way in.
      -->
      <div v-if="contextPrompt && !activePortId" class="context-prompt" @click="performAction">
        <span class="context-prompt__text">{{ contextPrompt.text }}</span>
        <span class="context-prompt__hint">Действие</span>
      </div>

      <!-- Always visible (keyboard/gamepad players want to see this too, not
           just touch) — two reload rings for the broadsides. Doubles as the
           touch fire buttons on a phone: hold to preview the hit-zone cone,
           release to fire (see fireLeft/fireRight hold-polling in
           WorldScene.update). Stays a clickable mouse target everywhere else
           as a bonus, not a requirement. Hidden while PortModal is open —
           firing/aiming input is locked then anyway (see the activePortId
           watch below), so a live ring here would just be a lie. -->
      <div v-if="!activePortId" class="broadside-hud">
        <button
          class="broadside-ring"
          :style="broadsideRingStyle(leftReloadFraction)"
          @pointerdown.prevent="controls.touchHoldStart('fireLeft')"
          @pointerup.prevent="controls.touchHoldEnd('fireLeft')"
          @pointercancel.prevent="controls.touchHoldEnd('fireLeft')"
          @pointerleave.prevent="controls.touchHoldEnd('fireLeft')"
        >
          <span class="broadside-ring__inner">
            <svg viewBox="0 0 24 24" fill="none" :stroke="leftReloadFraction >= 1 ? 'var(--c-success)' : 'rgba(238,245,242,0.45)'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="14" height="7" rx="3"/><circle cx="19" cy="12.5" r="4"/></svg>
          </span>
        </button>
        <button
          class="broadside-ring"
          :style="broadsideRingStyle(rightReloadFraction)"
          @pointerdown.prevent="controls.touchHoldStart('fireRight')"
          @pointerup.prevent="controls.touchHoldEnd('fireRight')"
          @pointercancel.prevent="controls.touchHoldEnd('fireRight')"
          @pointerleave.prevent="controls.touchHoldEnd('fireRight')"
        >
          <span class="broadside-ring__inner">
            <svg viewBox="0 0 24 24" fill="none" :stroke="rightReloadFraction >= 1 ? 'var(--c-success)' : 'rgba(238,245,242,0.45)'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="14" height="7" rx="3"/><circle cx="19" cy="12.5" r="4"/></svg>
          </span>
        </button>
      </div>

      <!-- Touch-only: a phone with no gamepad paired (see showTouchControls)
           gets an on-screen stick + action button instead of relying on
           WASD/gamepad. Sits above the canvas, so a tap here never also
           reaches the canvas's own pointerdown-fires-cannon handler below. -->
      <div v-if="showTouchControls && !activePortId" class="touch-controls">
        <TouchJoystick class="touch-controls__stick" />
        <button class="touch-btn" @pointerdown.prevent="controls.touchPress('action')">Действие</button>
      </div>

      <ShipInfoOverlay v-if="showInfo" :ship-info="shipInfo" :coins="coins" @close="showInfo = false" />

      <!--
        Opened straight over the world instead of navigating to a 'port/:id'
        route — the realtime room (and the whole Phaser game) used to get
        torn down and rejoined on every single port visit (see
        onBeforeUnmount's room.leave()/game.destroy() below), which is
        exactly the kind of churn that made the cargo-drop-vanishing bug
        possible in the first place (see this.autoDispose in WorldRoom.js).
        A modal just sits on top; nothing underneath disconnects. Player
        input is locked for its duration (see the watch below) so you can't
        sail off or fire while the shop's open.
      -->
      <PortModal v-if="activePortId" :key="activePortId" :port-id="activePortId" @close="activePortId = null" />
    </div>
  </q-page>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Notify } from 'quasar'
import Phaser from 'phaser'
import { getStateCallbacks } from 'colyseus.js'
import { joinWorld } from '@/services/realtime'
import { api } from '@/services/api'
import { controls, isPhone, onGamepadChange } from '@/services/controls'
import ShipInfoOverlay from '@/components/ShipInfoOverlay.vue'
import TouchJoystick from '@/components/TouchJoystick.vue'
import PortModal from '@/components/PortModal.vue'

const router = useRouter()
const container = ref(null)
const nearPort = ref(null)
const nearBot = ref(null)
const nearHuman = ref(null)
const showInfo = ref(false)
// Which port's PortModal is open, if any — set by enterPort, cleared by the
// modal's own 'close'. The watch further down locks/unlocks WorldScene's
// own movement+firing input to match, so the two can never drift apart.
const activePortId = ref(null)
const shipInfo = ref(null)
const coins = ref(0)

// Broadside готовность/перезарядка — 0 = только что выстрелил, 1 = готов.
// Optimistic/predicted from the moment 'fire' is sent (see fireBroadside in
// WorldScene below), not confirmed by the server — the server enforces the
// real cooldown independently and just silently ignores an early shot, so
// worst case this ring is briefly wrong instead of the fire being blocked.
const leftFiredAt = ref(0)
const rightFiredAt = ref(0)
const cooldownTick = ref(0)
let cooldownRaf = null
function pumpCooldownTick() {
  cooldownTick.value = Date.now()
  const stillCooling = Date.now() - leftFiredAt.value < FIRE_COOLDOWN_MS || Date.now() - rightFiredAt.value < FIRE_COOLDOWN_MS
  cooldownRaf = stillCooling ? requestAnimationFrame(pumpCooldownTick) : null
}
function noteBroadsideFired(uiSide) {
  const now = Date.now()
  if (uiSide === 'fireLeft') leftFiredAt.value = now
  else rightFiredAt.value = now
  if (!cooldownRaf) cooldownRaf = requestAnimationFrame(pumpCooldownTick)
}
const leftReloadFraction = computed(() => {
  void cooldownTick.value
  return Math.min(1, (Date.now() - leftFiredAt.value) / FIRE_COOLDOWN_MS)
})
const rightReloadFraction = computed(() => {
  void cooldownTick.value
  return Math.min(1, (Date.now() - rightFiredAt.value) / FIRE_COOLDOWN_MS)
})
function broadsideRingStyle(fraction) {
  const deg = Math.round(fraction * 360)
  const color = fraction >= 1 ? 'var(--c-success)' : 'var(--c-gold-bright)'
  return { background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.14) ${deg}deg 360deg)` }
}
// A gamepad paired to the phone is a better fit than an on-screen stick
// crowding the same screen — reactive because a Bluetooth controller can
// connect (or run out of battery and drop) mid-session, same pattern
// MenuPage uses for its "Управление" entry.
const showTouchControls = ref(isPhone() && !controls.firstGamepad())
let stopGamepadWatch = null
let game = null
let room = null

const MAP_SIZE = 4800
const SHIP_SPEED = 220
// Keep in sync with SHIP_SPEED_MULT in realtime/src/rooms/WorldRoom.js and
// the `speed` column in config/ships.php.
const SHIP_SPEED_MULT = {
  boat: 0.75, schooner: 0.75, caravel: 0.75, brig: 0.75,
  frigate: 1.0, galleon: 1.25, corvette: 2.0, battleship: 1.5,
}
// The pack's smallest hulls (boat/schooner) are drawn as tiny detail-less
// dinghies — at a uniform 0.5 scale they read as an unreadable dot on
// screen. Scaling per tier instead keeps a boat visible while still making
// a battleship read as clearly bigger than a corvette.
const SHIP_VISUAL_SCALE = {
  boat: 1.5, schooner: 1.3, caravel: 0.45, brig: 0.5,
  frigate: 0.55, galleon: 0.65, corvette: 0.5, battleship: 0.75,
}
const MOVE_SEND_INTERVAL_MS = 100
const OTHER_SHIP_LERP = 0.2 // fraction of remaining distance/angle closed per rendered frame

// Keep in sync with RELOAD_BASE_MS in realtime/src/rooms/WorldRoom.js —
// purely a predicted/optimistic display (see noteBroadsideFired below), the
// server enforces the real cooldown independently and just ignores an early
// 'fire' rather than telling the client to correct its guess. Reload is a
// per-cannon-level upgrade now, so a player who's actually invested in it
// reloads a little faster (up to 10%) than this constant assumes — the
// ring can read "still charging" for up to ~90ms after the server would
// already accept the next shot. Not worth plumbing the player's own
// average cannon level here just to shave off a barely-perceptible sliver;
// the server is what actually decides fire timing either way.
const FIRE_COOLDOWN_MS = 900

// Fallback cone length before the player's own first 'fired' broadcast has
// arrived (see lastKnownRange in create()) — the boat's base range from
// api/config/cannons.php, close enough for the very first aim-hold of a session.
const DEFAULT_AIM_RANGE = 78

// Keep in sync with SHIP_CANNON_COUNT in realtime/src/rooms/WorldRoom.js —
// how many individual cannons fan out per broadside (half of each entry
// here). Only used to size the aim-hold preview (see drawAimCone) before
// this player's first real shot has confirmed anything with the server;
// it's never trusted for actual hit resolution.
const SHIP_CANNON_COUNT = {
  boat: 6, schooner: 10, caravel: 14, brig: 16,
  frigate: 20, galleon: 24, corvette: 18, battleship: 30,
}

// Keep in sync with CANNON_SPREAD_HALF_ANGLE in
// realtime/src/rooms/WorldRoom.js — how far each individual gun in a
// broadside fans out from dead-center, in radians. Purely cosmetic here
// (see drawAimCone/spawnBroadsideVolley); the server resolves every ball's
// real flight path independently and never reads this copy.
const CANNON_SPREAD_HALF_ANGLE = 0.16

// Keep in sync with CARGO_DROP_TTL_MS in realtime/src/rooms/WorldRoom.js —
// purely cosmetic here (the server deletes the drop from state on its own
// schedule regardless of what this draws), just needs to agree so the ring
// hits empty around the same moment the crate actually disappears.
const CARGO_DROP_TTL_MS = 120000

// Must match SHORE_POINT_COUNT in realtime/src/worldgen.js — how many
// boundary samples each synced island's `points` array carries.
const SHORE_POINT_COUNT = 16
const MINIMAP_MARGIN = 12

// Keep in sync with config/ships.php's key order.
const SHIP_TYPES = ['boat', 'schooner', 'caravel', 'brig', 'frigate', 'galleon', 'corvette', 'battleship']
// Keep in sync with the 'name' field of each entry in config/ships.php.
const SHIP_TYPE_NAMES = {
  boat: 'Шлюпка', schooner: 'Шхуна', caravel: 'Каравелла', brig: 'Бриг',
  frigate: 'Фрегат', galleon: 'Галеон', corvette: 'Корвет', battleship: 'Линкор',
}
const NAME_TEXT_STYLE = { fontSize: '12px', color: '#ffffff', stroke: '#0a1f28', strokeThickness: 3 }
// Keep in sync with config/products.php's 'name' field — used only for the
// Notify toast text on a cargo pickup (see onCargoClaimed).
const PRODUCT_NAMES = {
  rum: 'Ром', silk: 'Шёлк', water: 'Вода', food: 'Еда',
  leather: 'Кожа', wood: 'Дерево', tobacco: 'Табак', coffee: 'Кофе',
}
const HP_BAR_WIDTH = 36
const HP_BAR_HEIGHT = 5
// Between the ship and its name label (name sits at -28) — reads as
// "belongs to this ship" without overlapping either.
const HP_BAR_Y_OFFSET = -21

function shipLabel(name, shipType) {
  return `${name} (${SHIP_TYPE_NAMES[shipType] ?? shipType})`
}

// Closed Catmull-Rom spline through a cyclic ring of points — real coasts
// don't have corners, but the raw boundary (SHORE_POINT_COUNT samples
// connected point-to-point) does. Purely a drawing concern: collision (see
// collidesWithIsland) keeps walking the original straight-line-interpolated
// boundary untouched, so a ship's actual stopping point never moves, only
// where the shore is painted relative to it — and the existing +20 buffer
// in that check already covers the small gap a smoothed curve opens up.
function smoothClosedPoints(points, segmentsPerEdge = 8) {
  const n = points.length
  const out = []
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const p3 = points[(i + 2) % n]
    for (let s = 0; s < segmentsPerEdge; s++) {
      const t = s / segmentsPerEdge
      const t2 = t * t
      const t3 = t2 * t
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      })
    }
  }
  return out
}

// Aggressive bots red, calm bots light orange, real players white — the
// name label's color is the only hostility indicator (see shipLabel usage
// below); the hull itself stays its natural color, no tint or halo.
function nameColor(player) {
  if (!player.isBot) return '#ffffff'
  return player.temperament === 'aggressive' ? '#ff4d4d' : '#ffc266'
}

// Ports now sit inset on an island's land rather than right on the
// coastline, so the water-reachable edge can be well short of this radius —
// wide and generous on purpose, so the button reliably shows up while still
// approaching by water instead of needing to hug the exact shore pixel.
const PORT_ENTER_RANGE = 220
const ABORDAGE_RANGE = 70 // "вплотную" — noticeably tighter than the port prompt

class WorldScene extends Phaser.Scene {
  constructor() {
    super('world')
  }

  init(data) {
    this.room = data.room
    this.ports = data.ports
    this.onNearPortChange = data.onNearPortChange
    this.onNearBotChange = data.onNearBotChange
    this.onNearHumanChange = data.onNearHumanChange
    this.onCargoClaimed = data.onCargoClaimed
    this.onActionRejected = data.onActionRejected
    this.onAbordageStarted = data.onAbordageStarted
    this.onActionPress = data.onActionPress
    this.onFireBroadside = data.onFireBroadside
    this.onInventoryPress = data.onInventoryPress
    this.onBackPress = data.onBackPress
    this.currentNearPortId = null
    this.currentNearBotId = null
    this.currentNearHumanId = null
  }

  preload() {
    // Kenney's Pirate Pack (CC0) — top-down, bow pointing up, so it drops
    // straight into the existing rotation convention with no math changes.
    // (A flat vector redraw replaced these briefly — reverted: the actual
    // pixel art reads better than a hand-rolled silhouette.)
    for (const type of SHIP_TYPES) this.load.image(`ship-${type}`, `ships/ship-${type}.png`)
    // Port marker — one icon from CraftPix.net's "48 Pirate Stuff Icons"
    // (opengameart.org/content/48-pirate-stuff-icons, OGA-BY 3.0, credit
    // required). Replaced a hand-drawn flag glyph that read as unclear.
    this.load.image('port-marker', 'markers/port-anchor.png')
  }

  create() {
    this.cameras.main.setBackgroundColor('#0e3b4d')
    this.physics.world.setBounds(0, 0, MAP_SIZE, MAP_SIZE)
    this.cameras.main.setBounds(0, 0, MAP_SIZE, MAP_SIZE)

    // Fires on every window/orientation resize once RESIZE mode is set on
    // the Game (see WorldPage.vue) — 'destroy' cleanup isn't needed here
    // since this.scale is the Game-level ScaleManager and dies with the
    // whole Game on unmount, same as everything else in this scene.
    this.scale.on('resize', (gameSize) => this.handleResize(gameSize))

    const cannonballTexture = this.make.graphics({ x: 0, y: 0 })
    cannonballTexture.fillStyle(0x1a1a1a, 1)
    cannonballTexture.fillCircle(4, 4, 4)
    cannonballTexture.generateTexture('cannonball', 8, 8)
    cannonballTexture.destroy()

    // Water used to be nothing but the renderer's flat clear color — a
    // tiled procedural texture instead (no water asset exists in the Kenney
    // pack the ships/islands come from, so this is drawn, not loaded):
    // a deep base tone plus a handful of long, gently offset wave lines
    // repeated across a 512² tile. Sits at depth -10, well behind islands
    // (depth 0) and ships (depth 0/1) — see their setDepth calls below.
    const waterTexture = this.make.graphics({ x: 0, y: 0 })
    waterTexture.fillStyle(0x123039, 1)
    waterTexture.fillRect(0, 0, 512, 512)
    waterTexture.lineStyle(2, 0x1a4048, 0.8)
    for (let row = 0; row < 6; row++) {
      const y = row * 90 + 20
      waterTexture.beginPath()
      waterTexture.moveTo(-20, y)
      waterTexture.lineTo(140, y + 16)
      waterTexture.lineTo(300, y - 12)
      waterTexture.lineTo(460, y + 10)
      waterTexture.lineTo(540, y - 4)
      waterTexture.strokePath()
    }
    waterTexture.lineStyle(1.5, 0x0e2830, 0.6)
    for (let row = 0; row < 5; row++) {
      const y = row * 95 + 65
      waterTexture.beginPath()
      waterTexture.moveTo(-20, y)
      waterTexture.lineTo(160, y - 14)
      waterTexture.lineTo(340, y + 12)
      waterTexture.lineTo(540, y - 8)
      waterTexture.strokePath()
    }
    waterTexture.generateTexture('water-tile', 512, 512)
    waterTexture.destroy()

    this.waterTile = this.add.tileSprite(0, 0, MAP_SIZE, MAP_SIZE, 'water-tile').setOrigin(0, 0).setDepth(-10)

    // Island foliage — used to be a single loaded blob-shaped PNG that read
    // as an unclear smudge at a glance. Drawn instead as a small round
    // canopy cluster (three overlapping fills, dark-to-light) with a trunk
    // peeking out the bottom — the same top-down "leaf cluster from above"
    // convention most top-down games draw a tree as.
    const treeTexture = this.make.graphics({ x: 0, y: 0 })
    treeTexture.fillStyle(0x6b4a2a, 1)
    treeTexture.fillCircle(16, 25, 4)
    treeTexture.fillStyle(0x1f5a38, 1)
    treeTexture.fillCircle(10, 15, 9)
    treeTexture.fillCircle(22, 15, 9)
    treeTexture.fillCircle(16, 9, 10)
    treeTexture.fillStyle(0x2f7d4f, 1)
    treeTexture.fillCircle(16, 12, 8)
    treeTexture.fillStyle(0x4fae72, 0.85)
    treeTexture.fillCircle(13, 8, 4.5)
    treeTexture.generateTexture('vegetation', 32, 32)
    treeTexture.destroy()

    // Small 4-point spark, paired with the floating damage number below
    // (see spawnDamageNumber) — same shape as the "hit" icon in Abordage's
    // round log, gold to match the rest of the accent palette.
    const sparkTexture = this.make.graphics({ x: 0, y: 0 })
    sparkTexture.fillStyle(0xf0c96b, 1)
    sparkTexture.fillPoints(
      [
        { x: 8, y: 0 }, { x: 9.6, y: 6.4 }, { x: 16, y: 8 }, { x: 9.6, y: 9.6 },
        { x: 8, y: 16 }, { x: 6.4, y: 9.6 }, { x: 0, y: 8 }, { x: 6.4, y: 6.4 },
      ],
      true,
    )
    sparkTexture.generateTexture('damage-spark', 16, 16)
    sparkTexture.destroy()

    // Floating cargo crate — same wood/gold-strap look as the crate icon
    // already used for the market tab elsewhere in the UI, just as a real
    // world sprite instead of an inline SVG.
    const crateTexture = this.make.graphics({ x: 0, y: 0 })
    crateTexture.fillStyle(0xc9a86a, 1)
    crateTexture.fillRect(2, 6, 28, 22)
    crateTexture.lineStyle(2, 0x4a3820, 1)
    crateTexture.strokeRect(2, 6, 28, 22)
    crateTexture.lineStyle(2, 0xd9a441, 1)
    crateTexture.lineBetween(2, 17, 30, 17)
    crateTexture.lineBetween(16, 6, 16, 28)
    crateTexture.generateTexture('cargo-crate', 32, 32)
    crateTexture.destroy()

    // Pill-shaped HP bars — Phaser's plain Rectangle game object can't do
    // rounded corners, so the bg/fill are baked once as small rounded-rect
    // textures (this used to be two flat Rectangle fills, just recolored,
    // not actually redrawn as the pill shape the rest of the HUD uses).
    // Rendered as Image + setCrop() rather than resizing a Rectangle each
    // frame — crop is a cheap geometry op, no redraw, same cost as the old
    // approach even with ~100 bots' bars updating every tick.
    const hpBarBgTexture = this.make.graphics({ x: 0, y: 0 })
    hpBarBgTexture.fillStyle(0x0b1a1f, 0.85)
    hpBarBgTexture.fillRoundedRect(0, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_HEIGHT / 2)
    hpBarBgTexture.generateTexture('hp-bar-bg', HP_BAR_WIDTH, HP_BAR_HEIGHT)
    hpBarBgTexture.destroy()
    for (const [key, color] of Object.entries({ good: 0x4fae72, mid: 0xf0c96b, bad: 0xe2685e })) {
      const fillTexture = this.make.graphics({ x: 0, y: 0 })
      fillTexture.fillStyle(color, 1)
      fillTexture.fillRoundedRect(0, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_HEIGHT / 2)
      fillTexture.generateTexture(`hp-bar-fill-${key}`, HP_BAR_WIDTH, HP_BAR_HEIGHT)
      fillTexture.destroy()
    }

    for (const port of this.ports) {
      const marker = this.add.image(port.x, port.y, 'port-marker').setOrigin(0.5)
      marker.setDepth(2)
      // Dark backing pill behind the world-view name — a plain stroke read
      // fine on open water but got lost against light sand right at a
      // port's own shore, exactly where a player is looking at this label.
      const worldLabel = this.add.text(port.x, port.y + 24, port.name, { fontSize: '13px', fontStyle: 'bold', color: '#f0c96b' }).setOrigin(0.5, 0).setDepth(3)
      const worldLabelBg = this.add
        .rectangle(port.x, port.y + 24 + worldLabel.height / 2, worldLabel.width + 14, worldLabel.height + 6, 0x06141a, 0.68)
        .setOrigin(0.5)
        .setDepth(2)

      // The real marker is only 36 world-units across — invisible at
      // minimap zoom. Same exaggerated-dot trick as the player marker,
      // main-camera-only-ignored so it doesn't show twice in the world.
      // Gold, not red — a port is a landmark, not a threat, and red is
      // reserved for hostile HP-bar/fill states elsewhere in the HUD.
      const miniDot = this.add.circle(port.x, port.y, 130, 0xd9a441).setStrokeStyle(30, 0x0b1a1f, 1).setDepth(999)
      this.cameras.main.ignore(miniDot)

      // A screen-space (scrollFactor 0) label rendered THROUGH the minimap
      // camera doesn't work here — that camera's own ~0.02-0.04 zoom shrinks
      // everything it draws, screen-space or not, back into illegible dust
      // (tried that first). This is world-space instead, same trick as
      // miniDot above: sized enormous (a name easily 250-400 world-units
      // tall) so the minimap camera's own zoom brings it back down to a
      // normal-looking ~8-15 screen px, exactly the way miniDot's oversized
      // world-radius does for the gold dot itself.
      const miniLabel = this.add
        .text(port.x, port.y + 190, port.name, { fontSize: '300px', fontStyle: 'bold', color: '#f0c96b', stroke: '#0b1a1f', strokeThickness: 40 })
        .setOrigin(0.5, 0)
        .setDepth(1000)
      this.cameras.main.ignore(miniLabel)
    }

    // Real archipelago now, synced from the server (see state.islands) —
    // each island is a wobbly polygon, not a circle, so it's drawn as one
    // and collision below walks the same boundary instead of an Arcade
    // circle body (Arcade can't do concave shapes; Matter.js could, but a
    // hand-rolled radial check matching the server's own island math is
    // simpler than swapping physics engines for this).
    this.islandsData = this.room.state.islands.map((i) => ({ x: i.x, y: i.y, baseRadius: i.baseRadius, points: [...i.points] }))

    for (const island of this.islandsData) {
      const gfx = this.add.graphics()
      const n = island.points.length
      const rawPoints = []
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2
        const r = island.points[i]
        rawPoints.push({ x: island.x + Math.cos(angle) * r, y: island.y + Math.sin(angle) * r })
      }
      // Smoothed purely for drawing (see smoothClosedPoints's own comment) —
      // a darker wet-sand base plus a lighter dry-sand inset pulled toward
      // the island's own center, the two-tone beach a flat single fill
      // doesn't read as.
      const shore = smoothClosedPoints(rawPoints)
      gfx.fillStyle(0xc9ac70, 1)
      gfx.beginPath()
      shore.forEach((p, i) => (i === 0 ? gfx.moveTo(p.x, p.y) : gfx.lineTo(p.x, p.y)))
      gfx.closePath()
      gfx.fillPath()

      gfx.fillStyle(0xe0c98a, 1)
      gfx.beginPath()
      shore.forEach((p, i) => {
        const ix = island.x + (p.x - island.x) * 0.86
        const iy = island.y + (p.y - island.y) * 0.86
        if (i === 0) gfx.moveTo(ix, iy)
        else gfx.lineTo(ix, iy)
      })
      gfx.closePath()
      gfx.fillPath()
      gfx.setDepth(0)

      const clumps = Math.max(2, Math.round(island.baseRadius / 25))
      for (let i = 0; i < clumps; i++) {
        const angle = Math.random() * Math.PI * 2
        const dist = Math.random() * island.baseRadius * 0.55
        // No random rotation — unlike the old symmetric blob, this texture
        // has a real trunk fixed at the bottom, so spinning it scattered
        // trunks in every direction instead of planting them in the ground.
        const leaf = this.add.sprite(island.x + Math.cos(angle) * dist, island.y + Math.sin(angle) * dist, 'vegetation')
        leaf.setScale(0.6 + Math.random() * 0.5)
        leaf.setDepth(1)
      }
    }

    const me = this.room.state.players.get(this.room.sessionId)
    this.myMaxHp = me?.maxHp ?? 500
    this.mySpeed = SHIP_SPEED * (SHIP_SPEED_MULT[me?.shipType] ?? 1)
    this.ship = this.physics.add.sprite(me?.x ?? 1200, me?.y ?? 1200, `ship-${me?.shipType ?? 'boat'}`)
    this.ship.setScale(SHIP_VISUAL_SCALE[me?.shipType] ?? 0.5)
    // Arcade bodies don't reliably follow a post-creation setScale() across
    // Phaser versions — sizing explicitly avoids a hitbox that doesn't match
    // what's on screen. Smaller than the full (mostly-transparent) sprite
    // bounds, matching the hull rather than the sail's empty corners.
    this.ship.body.setSize(this.ship.width * 0.6, this.ship.height * 0.6)
    this.ship.setDamping(true)
    this.ship.setDrag(0.85)
    this.ship.setMaxVelocity(this.mySpeed)
    this.ship.setCollideWorldBounds(true)
    // Last position known NOT to be inside an island — see collidesWithIsland
    // below, checked/restored every frame instead of an Arcade collider.
    this.lastGoodX = this.ship.x
    this.lastGoodY = this.ship.y

    this.myNameText = this.add
      .text(this.ship.x, this.ship.y - 28, shipLabel(me?.firstName ?? 'Вы', me?.shipType ?? 'boat'), NAME_TEXT_STYLE)
      .setOrigin(0.5, 1)
      .setDepth(10)
    this.myNameCard = this.createNameCard(this.myNameText)
    // Same live schema reference room.state.players.get() always returns —
    // its .hp mutates in place as server patches arrive, so reading it
    // fresh every frame (see update()) needs no separate 'hit'-message
    // plumbing the way the top-left HUD text still does.
    this.meRef = me
    this.myHpBar = this.createHpBar(this.ship.x, this.ship.y + HP_BAR_Y_OFFSET)

    this.cameras.main.startFollow(this.ship, true, 0.1, 0.1)

    this.hpText = this.add.text(12, 12, `HP: ${me?.hp ?? this.myMaxHp}/${this.myMaxHp}`, { fontSize: '16px', color: '#ffffff' })
    this.hpText.setScrollFactor(0)
    this.coordText = this.add.text(12, 34, '', { fontSize: '13px', color: '#bcd9d1' })
    this.coordText.setScrollFactor(0)

    this.setupMinimap()

    this.lastMoveSentAt = 0
    this.otherShips = new Map()
    this.cargoDropSprites = new Map() // dropId -> { crate, ring, x, y, spawnedAt }
    this.activeCannonballs = new Map() // `${attackerId}:${side}` -> array of in-flight ball sprites (a whole volley, see spawnBroadsideVolley)
    // Guards fireBroadside below — mashing fire mid-reload used to still
    // reset the HUD ring's animation (via onFireBroadside) even though no
    // ball actually flew, since the server silently drops the early 'fire'
    // but the client had no idea it was early and reset anyway.
    this.lastBroadsideFiredAt = { fireLeft: 0, fireRight: 0 }

    // Hold-to-aim: press/hold a broadside input to preview its hit-zone
    // cone, release to actually fire (see the per-frame polling in update()
    // and the aim cones set up just below). lastKnownRange starts at the
    // boat default and gets corrected the instant this player's own first
    // 'fired' broadcast arrives (see setupNetworking) — close enough for
    // the very first hold before that, and exact for every one after.
    this.wasHeld = { fireLeft: false, fireRight: false }
    this.lastKnownRange = { fireLeft: DEFAULT_AIM_RANGE, fireRight: DEFAULT_AIM_RANGE }
    // Set by setInputLocked (see WorldPage.vue's activePortId watch) while
    // PortModal is open — freezes movement/aiming/firing without tearing
    // down the scene or leaving the room, just like standing still.
    this.inputLocked = false
    // Translucent hit-zone cones, one per broadside, drawn/cleared each
    // frame in update() while that side is held. Minimap must never show
    // these — same reasoning as every other screen-only HUD graphic.
    this.aimCones = { fireLeft: this.add.graphics().setDepth(8), fireRight: this.add.graphics().setDepth(8) }
    this.minimapCam?.ignore([this.aimCones.fireLeft, this.aimCones.fireRight])

    this.setupNetworking()

    // Mouse buttons used to fire immediately on press; now they're just
    // another held-input source polled each frame in update(), same as
    // keyboard/gamepad/touch (see the fireLeft/fireRight hold-detection
    // there) — pointerdown/up only need to be tracked, not acted on here.
    // 'left'/'right' server-side are the internal labels for the two
    // broadside vectors — when the bow faces up-screen, the vector labeled
    // 'right' actually points screen-left (verified against the working
    // hit-detection math, not guessed), so the screen-left broadside
    // (mouse left button) sends 'right' and the screen-right one (mouse
    // right button) sends 'left'. See broadsideDirection() for the same
    // mapping applied to the cone's drawn direction.
    this.input.mouse?.disableContextMenu()

    // Rebindable keyboard/gamepad actions (see services/controls.js) —
    // fireLeft/fireRight are now polled by held-state in update() instead
    // of onPress (see gamepadButtonHeld/controls.isDown there); action/
    // inventory/back stay discrete press events, unchanged.
    // Guarded by inputLocked too, not just the per-frame movement/firing —
    // PortModal has its OWN 'back'/'inventory' listeners (see
    // PortModal.vue) that are meant to close/open ITS overlay while it's
    // open; without this guard, the exact same button press would ALSO hit
    // these still-live World listeners underneath (onBackPress leaves the
    // world entirely — very much not what closing a shop dialog should do).
    this.controlUnsubs = [
      controls.onPress('action', () => { if (!this.inputLocked) this.onActionPress?.() }),
      controls.onPress('inventory', () => { if (!this.inputLocked) this.onInventoryPress?.() }),
      // Circle/B on a gamepad, Escape on keyboard — same universal "back"
      // convention as every other screen (Port, Abordage, Loot, Controls),
      // just meaning "leave the world" here instead of "close this dialog".
      controls.onPress('back', () => { if (!this.inputLocked) this.onBackPress?.() }),
    ]
    // 'shutdown' fires on scene.stop(); 'destroy' is what actually fires
    // when the whole Game is torn down (see onBeforeUnmount's
    // game.destroy() below) — listening to only one left a stale
    // subscription behind on navigation, which then answered every future
    // 'action'/'inventory' press from whatever page loaded next (harmless
    // to that page since emit() now also survives a broken listener, but
    // still dead code worth actually cleaning up).
    const unsubscribeAll = () => this.controlUnsubs.forEach((unsub) => unsub())
    this.events.once('shutdown', unsubscribeAll)
    this.events.once('destroy', unsubscribeAll)
  }

  setupNetworking() {
    const mySessionId = this.room.sessionId
    // Schema v3 callbacks aren't methods on the collection itself anymore —
    // they're registered through this proxy. See colyseus.js docs / DECK
    // notes: getStateCallbacks(room), then $(room.state).<field>.onAdd(...).
    const $ = getStateCallbacks(this.room)

    // this.meRef.hp is already read fresh every frame (see updateHpBar in
    // update()), so a repair/damage patch alone needs no extra wiring here.
    // maxHp/shipType aren't re-read every frame though — they're cached
    // once, into myMaxHp/mySpeed/the ship sprite's own texture, back in
    // create() — so buying a new hull (or repairing, which changes hp but
    // not these) needs this to actually show up: the HP bar's own
    // denominator, movement speed, and the sprite itself would otherwise
    // stay stuck on whatever ship you were sailing when the scene first
    // loaded. See 'refresh_ship' in WorldRoom.js for what pushes the
    // schema patch that triggers this in the first place.
    $(this.meRef).onChange(() => {
      this.myMaxHp = this.meRef.maxHp
      this.mySpeed = SHIP_SPEED * (SHIP_SPEED_MULT[this.meRef.shipType] ?? 1)
      // setVelocity below is capped by the Arcade body's own maxVelocity —
      // set once from the OLD mySpeed back in create() and never touched
      // since. Recomputing mySpeed alone silently did nothing: a faster
      // new hull's velocity just got clamped straight back down to the
      // old ceiling, which is exactly why the ship kept sailing at its
      // previous speed after buying a new one.
      this.ship.setMaxVelocity(this.mySpeed)
      const textureKey = `ship-${this.meRef.shipType}`
      if (this.ship.texture.key !== textureKey) {
        this.ship.setTexture(textureKey)
        this.ship.setScale(SHIP_VISUAL_SCALE[this.meRef.shipType] ?? 0.5)
        // Same hull-not-sail sizing create() used, re-applied against the
        // NEW texture's own raw frame size — left at the old ship's
        // dimensions otherwise (a Boat's tiny hitbox on a Battleship's
        // hull, or the reverse), same staleness bug as maxVelocity above.
        this.ship.body.setSize(this.ship.width * 0.6, this.ship.height * 0.6)
        this.myNameText.setText(shipLabel(this.meRef.firstName ?? 'Вы', this.meRef.shipType))
      }
    })

    $(this.room.state).players.onAdd((player, sessionId) => {
      if (sessionId === mySessionId) return

      // Hull stays its natural color — the name label's color (below) is
      // the only hostility indicator now. A halo/tint on the ship itself
      // either wrecked the sprite's own art or just read as unexplained
      // clutter, per direct feedback.
      const sprite = this.add.sprite(player.x, player.y, `ship-${player.shipType || 'boat'}`).setDepth(1)
      sprite.setScale(SHIP_VISUAL_SCALE[player.shipType] ?? 0.5)
      sprite.setRotation(player.rotation)
      sprite.isBot = player.isBot
      sprite.firstName = player.firstName
      sprite.shipType = player.shipType
      // Server state only patches to clients a handful of times per second —
      // snapping straight to it on every packet is what read as "jerky".
      // Store the latest known target and glide toward it every render
      // frame instead (interpolation, not the raw network rate).
      sprite.targetX = player.x
      sprite.targetY = player.y
      sprite.targetRotation = player.rotation
      sprite.nameText = this.add
        .text(player.x, player.y - 28, shipLabel(player.firstName, player.shipType), { ...NAME_TEXT_STYLE, color: nameColor(player) })
        .setOrigin(0.5, 1)
        .setDepth(10) // above ship art — with ~100 bots on screen, overlapping hulls shouldn't make a name look detached from its own ship
      sprite.nameCard = this.createNameCard(sprite.nameText)
      this.minimapCam.ignore([sprite.nameText, sprite.nameCard])
      // Same live schema object the position/rotation lerp target below
      // reads from — .hp/.maxHp mutate in place as server patches land, no
      // separate tracking needed.
      sprite.playerRef = player
      sprite.hpBar = this.createHpBar(player.x, player.y + HP_BAR_Y_OFFSET)
      this.minimapCam.ignore([sprite.hpBar.bg, sprite.hpBar.fill])
      this.otherShips.set(sessionId, sprite)

      $(player).onChange(() => {
        sprite.targetX = player.x
        sprite.targetY = player.y
        sprite.targetRotation = player.rotation
      })
    })

    $(this.room.state).players.onRemove((player, sessionId) => {
      const sprite = this.otherShips.get(sessionId)
      sprite?.nameText.destroy()
      sprite?.nameCard.destroy()
      sprite?.hpBar.bg.destroy()
      sprite?.hpBar.fill.destroy()
      sprite?.destroy()
      this.otherShips.delete(sessionId)
    })

    // The ring is redrawn every frame in update() (see cargoDropSprites),
    // not here — its shape depends on elapsed time, not on anything this
    // onAdd callback knows yet.
    $(this.room.state).cargoDrops.onAdd((drop, id) => {
      const crate = this.add.image(drop.x, drop.y, 'cargo-crate').setDepth(3)
      const ring = this.add.graphics().setDepth(4)
      this.minimapCam.ignore([crate, ring])
      this.cargoDropSprites.set(id, { crate, ring, x: drop.x, y: drop.y, spawnedAt: drop.spawnedAt })
    })

    $(this.room.state).cargoDrops.onRemove((drop, id) => {
      const entry = this.cargoDropSprites.get(id)
      entry?.crate.destroy()
      entry?.ring.destroy()
      this.cargoDropSprites.delete(id)
    })

    this.room.onMessage('fired', ({ attackerId, side, count, range, speed }) => {
      this.spawnBroadsideVolley(attackerId, side, count, range, speed)
      // Corrects the aim cone's length to this player's real, possibly
      // upgraded, cannon range the moment it's actually known — see
      // lastKnownRange's setup in create(). Same server-side->UI-side
      // inversion as everywhere else ('right' broadcasts are the fireLeft
      // broadside, 'left' broadcasts are fireRight).
      if (attackerId === this.room.sessionId) {
        this.lastKnownRange[side === 'right' ? 'fireLeft' : 'fireRight'] = range
      }
    })

    this.room.onMessage('hit', ({ attackerId, targetId, damage, hp }) => {
      // A broadside is now several independent balls (see
      // spawnBroadsideVolley) — this message is about exactly ONE of them
      // finding its mark, so only the visual ball nearest the target gets
      // cut short; the rest of the volley keeps flying toward its own miss.
      const targetX = targetId === mySessionId ? this.ship.x : this.otherShips.get(targetId)?.x
      const targetY = targetId === mySessionId ? this.ship.y : this.otherShips.get(targetId)?.y
      if (targetX !== undefined) this.stopNearestCannonball(attackerId, targetX, targetY)
      if (targetId === mySessionId) {
        this.hpText.setText(`HP: ${hp}/${this.myMaxHp}`)
        this.spawnDamageNumber(this.ship.x, this.ship.y, damage)
      } else {
        // The floating "-NN" (see spawnDamageNumber) is the "just got hit"
        // signal now — a red screen flash / hull tint on top of it read as
        // redundant, per direct feedback.
        const targetSprite = this.otherShips.get(targetId)
        if (targetSprite) this.spawnDamageNumber(targetSprite.x, targetSprite.y, damage)
      }
    })

    // The server now actually stops a ball at the shoreline (see
    // tickCannonballs in WorldRoom.js) instead of letting shots pass through
    // islands — without this the client's blind visual tween would keep
    // flying straight through the land it just got blocked by. Only the one
    // ball that actually hit the shore at (x, y) stops — same reasoning as
    // 'hit' above, now that a volley is several independent balls.
    this.room.onMessage('cannonball_blocked', ({ attackerId, x, y }) => this.stopNearestCannonball(attackerId, x, y))

    this.room.onMessage('sunk', ({ targetId, respawnHp, respawnX, respawnY }) => {
      if (targetId !== mySessionId) return
      // The ship's own position is client-authoritative during normal play
      // (see the architecture note at the top of WorldRoom.js) — a
      // server-initiated teleport like this respawn has to be applied here
      // explicitly, or the next 'move' packet would just report the stale
      // pre-death position right back and overwrite the server's reset.
      this.ship.setPosition(respawnX, respawnY)
      this.ship.setVelocity(0, 0)
      this.lastGoodX = respawnX
      this.lastGoodY = respawnY
      this.hpText.setText(`HP: ${respawnHp}/${this.myMaxHp} (потоплен, респавн у порта)`)
    })

    // Naval-kill loot is a floating CargoDrop now (see spawnCargoDrop in
    // WorldRoom.js), not an instant private reward — this only fires once
    // this specific client actually reached and claimed one (server-side,
    // see claimCargoDrop), never just for landing the killing blow.
    this.room.onMessage('cargo_claimed', ({ gold, products }) => this.onCargoClaimed(gold, products))

    // Sent directly to both participants (not broadcast) — see
    // startPvpAbordage in WorldRoom.js. No accept/decline: both clients
    // just get redirected the instant Laravel confirms the fight exists.
    this.room.onMessage('abordage_started', ({ abordageId }) => this.onAbordageStarted(abordageId))

    // ABORDAGE_RANGE is tight (70 units, "вплотную") — a moving target plus
    // the round-trip to the server is enough to have sailed back out of
    // range by the time this resolves. Used to just do nothing, which read
    // as the feature being silently broken; this at least says why.
    const ABORDAGE_REJECTION_TEXT = { in_port_zone: 'В зоне порта нельзя', out_of_range: 'Слишком далеко', server_error: 'Не удалось начать абордаж' }
    this.room.onMessage('abordage_rejected', ({ reason }) => {
      this.onActionRejected?.(ABORDAGE_REJECTION_TEXT[reason] ?? 'Абордаж не удался')
    })

    // Backstop for handleFire's own isNearAnyPort check in WorldRoom.js —
    // updateAiming already stops a hold-to-aim release from ever sending
    // 'fire' while this client already knows it's docked (see
    // this.currentNearPortId there), so this normally never fires. Kept as
    // a real server round trip anyway so a stale/wrong client-side guess
    // still gets told "no" instead of silently eating the shot.
    this.room.onMessage('fire_rejected', ({ reason }) => {
      if (reason === 'in_port_zone') this.onActionRejected?.('Нельзя стрелять на территории порта')
    })
  }

  /**
   * A blind visual guess, started the instant 'fire' arrives for low-latency
   * feedback — the real resolution now happens server-side over the flight
   * (see tickCannonballs in WorldRoom.js), which is what actually decides
   * hit/miss/blocked and can arrive before any of these tweens finish. When
   * it does, 'hit'/'cannonball_blocked' calls stopNearestCannonball() to cut
   * the one ball that actually resolved short, instead of letting it
   * visibly fly past what stopped it — the other balls in this same volley
   * are unaffected and keep flying toward their own individual range/miss.
   *
   * One shot is now `count` separate balls (one per real cannon on that
   * side, see broadsideCannons in WorldRoom.js), fanned evenly across
   * CANNON_SPREAD_HALF_ANGLE exactly like the server just did — this only
   * needs the aggregate range/speed the server sends, not each individual
   * cannon's exact numbers, since the actual hit/miss and damage are
   * already fully decided server-side by the time this plays.
   */
  spawnBroadsideVolley(attackerId, side, count, range, speed) {
    const attacker = this.room.state.players.get(attackerId)
    if (!attacker) return

    const fx = Math.sin(attacker.rotation)
    const fy = -Math.cos(attacker.rotation)
    const dir = side === 'right' ? { x: fy, y: -fx } : { x: -fy, y: fx }
    const baseAngle = Math.atan2(dir.y, dir.x)

    const key = `${attackerId}:${side}`
    // A fresh volley firing before the previous one's balls have all
    // resolved (fast reload) doesn't cut those short — they're still
    // legitimately in flight — just stop tracking them under this key so
    // this volley's own list isn't polluted with stale entries.
    this.activeCannonballs.set(key, [])
    const list = this.activeCannonballs.get(key)

    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5 // -0.5..0.5
      const angle = baseAngle + t * 2 * CANNON_SPREAD_HALF_ANGLE
      const bx = Math.cos(angle)
      const by = Math.sin(angle)

      const ball = this.add.sprite(attacker.x, attacker.y, 'cannonball')
      list.push(ball)
      this.tweens.add({
        targets: ball,
        x: attacker.x + bx * range,
        y: attacker.y + by * range,
        duration: (range / speed) * 1000,
        onComplete: () => {
          ball.destroy()
          const idx = list.indexOf(ball)
          if (idx !== -1) list.splice(idx, 1)
        },
      })
    }
  }

  /** Stops whichever in-flight ball (across both of this attacker's sides) is currently closest to (x, y) — the one 'hit'/'cannonball_blocked' just said resolved there. Leaves every other ball in the volley flying. */
  stopNearestCannonball(attackerId, x, y) {
    let closest = null
    let closestList = null
    let closestDist = Infinity
    for (const side of ['left', 'right']) {
      const list = this.activeCannonballs.get(`${attackerId}:${side}`)
      if (!list) continue
      for (const ball of list) {
        const dist = Math.hypot(ball.x - x, ball.y - y)
        if (dist < closestDist) {
          closestDist = dist
          closest = ball
          closestList = list
        }
      }
    }
    if (!closest) return
    this.tweens.killTweensOf(closest)
    closest.destroy()
    closestList.splice(closestList.indexOf(closest), 1)
  }

  /**
   * Floating "-NN" over a ship that just got hit — a spark plus a number
   * that rises and fades, same tween shape as the '+amount золота' bounty
   * toast a bit further up, just angrier-colored and a size bigger so it
   * still reads clearly mid-fight with cannonballs and other ships around.
   */
  spawnDamageNumber(x, y, damage) {
    const spark = this.add.image(x - 16, y - 34, 'damage-spark').setDepth(20)
    const toast = this.add
      .text(x - 2, y - 34, `−${damage}`, { fontSize: '20px', fontStyle: 'bold', color: '#ff9d94', stroke: '#2c1210', strokeThickness: 3 })
      .setOrigin(0, 0.5)
      .setDepth(20)
    this.tweens.add({
      targets: [spark, toast],
      y: '-=34',
      alpha: 0,
      duration: 900,
      onComplete: () => {
        spark.destroy()
        toast.destroy()
      },
    })
  }

  update(time) {
    // controls.js now drives its own gamepad-polling loop internally (see
    // its constructor) — this used to be the only place that called
    // controls.update() each frame, which meant the gamepad was silently
    // dead everywhere outside this scene (the menu, the controls settings
    // page). No longer needs to be called from here at all.

    // Physics already integrated this frame's motion before update() runs —
    // check the result against the real archipelago shape (not an Arcade
    // circle body, see create()) and snap back if it landed on land.
    if (this.collidesWithIsland(this.ship.x, this.ship.y)) {
      // Only revert if the *previous* good position is actually still
      // valid — a ship that loaded already inside land (a stale save from
      // before the archipelago was denser, or a port sitting close to
      // shore) would otherwise get snapped straight back to that same bad
      // spot every single frame, forever, with no way to ever sail out.
      // Better to just let it move freely until it finds clear water.
      if (!this.collidesWithIsland(this.lastGoodX, this.lastGoodY)) {
        this.ship.setPosition(this.lastGoodX, this.lastGoodY)
        this.ship.setVelocity(0, 0)
      }
    } else {
      this.lastGoodX = this.ship.x
      this.lastGoodY = this.ship.y
    }

    // PortModal open (see setInputLocked) — the ship just sits exactly
    // where it was when the modal opened. Movement, the network 'move'
    // send, and firing/aiming all skip entirely; other ships, cargo drops,
    // camera, and HUD text below keep updating normally underneath —
    // nothing else about the world pauses just because your menu is open.
    if (!this.inputLocked) {
      const move = controls.getMoveVector()
      let vx = move.x
      let vy = move.y

      if (vx !== 0 || vy !== 0) {
        const len = Math.hypot(vx, vy)
        this.ship.setVelocity((vx / len) * this.mySpeed, (vy / len) * this.mySpeed)
        this.ship.setRotation(Math.atan2(vy, vx) + Math.PI / 2)
      } else {
        this.ship.setVelocity(0, 0)
      }

      if (time - this.lastMoveSentAt > MOVE_SEND_INTERVAL_MS) {
        this.lastMoveSentAt = time
        this.room.send('move', { x: this.ship.x, y: this.ship.y, rotation: this.ship.rotation })
      }

      // Ahead of updateAiming below — it reads this.currentNearPortId to
      // decide whether firing is even possible this frame (see
      // updateAiming's own comment), so it needs this frame's fresh result,
      // not last frame's.
      this.checkNearPort()
      this.updateAiming()
    }

    for (const sprite of this.otherShips.values()) {
      sprite.x += (sprite.targetX - sprite.x) * OTHER_SHIP_LERP
      sprite.y += (sprite.targetY - sprite.y) * OTHER_SHIP_LERP
      // Shortest-path angle interpolation — a plain lerp on raw radians spins
      // the wrong way whenever a turn crosses the 0/2π wraparound.
      const diff = Math.atan2(Math.sin(sprite.targetRotation - sprite.rotation), Math.cos(sprite.targetRotation - sprite.rotation))
      sprite.rotation += diff * OTHER_SHIP_LERP
      sprite.nameText.setPosition(sprite.x, sprite.y - 28)
      sprite.nameCard.setPosition(sprite.x, sprite.y + sprite.nameCard.yOffset)
      this.updateHpBar(sprite.hpBar, sprite.x, sprite.y, sprite.playerRef.hp, sprite.playerRef.maxHp)
    }

    this.coordText.setText(`X: ${Math.round(this.ship.x)}  Y: ${Math.round(this.ship.y)}`)
    this.minimapPlayerDot.setPosition(this.ship.x, this.ship.y)
    this.myNameText.setPosition(this.ship.x, this.ship.y - 28)
    this.myNameCard.setPosition(this.ship.x, this.ship.y + this.myNameCard.yOffset)
    this.updateHpBar(this.myHpBar, this.ship.x, this.ship.y, this.meRef?.hp ?? this.myMaxHp, this.myMaxHp)

    this.checkNearBot()
    this.checkNearHuman()

    // A radial "loading circle" countdown, not digits — redrawn every
    // frame since its shape (not just its position) changes over time.
    // Position never changes (crates are stationary), only the arc.
    for (const entry of this.cargoDropSprites.values()) {
      const fraction = Math.max(0, 1 - (Date.now() - entry.spawnedAt) / CARGO_DROP_TTL_MS)
      entry.ring.clear()
      entry.ring.lineStyle(3, 0xf0c96b, 0.9)
      entry.ring.beginPath()
      entry.ring.arc(entry.x, entry.y - 24, 12, -Math.PI / 2, -Math.PI / 2 + fraction * Math.PI * 2, false)
      entry.ring.strokePath()
    }
  }

  /**
   * Same radial-boundary check as WorldRoom.js's collidesWithIsland — walks
   * each island's wobbly `points` ring rather than treating it as a circle,
   * so the client's collision actually matches what's drawn on screen.
   */
  collidesWithIsland(x, y) {
    for (const island of this.islandsData) {
      const dist = Math.hypot(x - island.x, y - island.y)
      const angle = Math.atan2(y - island.y, x - island.x)
      const twoPi = Math.PI * 2
      const norm = ((angle % twoPi) + twoPi) % twoPi
      const scaled = (norm / twoPi) * SHORE_POINT_COUNT
      const i0 = Math.floor(scaled) % SHORE_POINT_COUNT
      const i1 = (i0 + 1) % SHORE_POINT_COUNT
      const t = scaled - Math.floor(scaled)
      const boundary = island.points[i0] + (island.points[i1] - island.points[i0]) * t
      if (dist < boundary + 20) return true
    }
    return false
  }

  // A flat 200px was roughly half the screen width on a narrow phone —
  // scale with the actual viewport instead, clamped so it's never too
  // cramped to read (small screen) or oversized for no reason (large one).
  // Pulled out of setupMinimap so a resize (see handleResize) can recompute
  // the same layout instead of the minimap staying pinned to its
  // create()-time position/size after the canvas itself has resized.
  //
  // Sized against height too, not just width — a landscape phone is wide
  // but short, and width-only sizing pushed the minimap to its full 200px
  // there, running its bottom edge straight into the touch fire/action
  // buttons anchored in that same top-right/bottom-right corner.
  minimapLayout() {
    const size = Math.round(Math.max(90, Math.min(200, this.scale.width * 0.32, this.scale.height * 0.3)))
    return { size, x: this.scale.width - size - MINIMAP_MARGIN, y: MINIMAP_MARGIN }
  }

  // Redraws the rounded backing/border in place (both setup and every
  // resize need this exact shape at a new x/y/size — see repositionMinimap).
  drawMinimapFrame(x, y, size) {
    const frame = this.minimapFrame
    frame.clear()
    frame.fillStyle(0x0b1a1f, 0.85)
    frame.fillRoundedRect(x - 2, y - 2, size + 4, size + 4, 12)
    frame.lineStyle(2, 0xd9a441, 0.55)
    frame.strokeRoundedRect(x - 2, y - 2, size + 4, size + 4, 12)
  }

  setupMinimap() {
    const { size, x, y } = this.minimapLayout()

    this.minimapFrame = this.add.graphics().setScrollFactor(0)
    this.drawMinimapFrame(x, y, size)

    // Rounds the map content itself to match the frame — a geometry mask
    // built from an un-added Graphics shape (this.make, not this.add, so it
    // never renders on its own), redrawn alongside the frame on every
    // resize (see repositionMinimap).
    this.minimapMaskShape = this.make.graphics({ x: 0, y: 0 })
    this.minimapMaskShape.fillStyle(0xffffff)
    this.minimapMaskShape.fillRoundedRect(x, y, size, size, 10)

    this.minimapCam = this.cameras.add(x, y, size, size)
    this.minimapCam.setZoom(size / MAP_SIZE)
    this.minimapCam.setBounds(0, 0, MAP_SIZE, MAP_SIZE)
    this.minimapCam.setBackgroundColor('#123039')
    this.minimapCam.setMask(this.minimapMaskShape.createGeometryMask())

    // A dedicated bright marker — the real ship sprite is only a few
    // world-units across and disappears at minimap zoom otherwise, and with
    // ~100 bots on the map now it'd be lost in the crowd anyway. A big
    // outlined dot on top of everything else is the only way to actually
    // spot yourself. Only meant for the minimap, so the main camera must
    // ignore it — otherwise it renders as a giant circle over the real ship.
    // Cyan — deliberately far from the gold port markers and the red HP-bar
    // danger state so it never gets mistaken for either at a glance.
    this.minimapPlayerDot = this.add.circle(this.ship.x, this.ship.y, 160, 0x4ce0ff).setStrokeStyle(40, 0x0a3540, 1).setDepth(1000)
    // Only meant for the minimap — the main camera must ignore it, or it
    // renders as a giant circle over the real ship. It must NOT also be in
    // minimapCam's ignore list below (that was the actual bug: it ended up
    // hidden from both cameras, same mistake the frame had earlier).
    this.cameras.main.ignore(this.minimapPlayerDot)

    // Compass rose in the corner — world-space, same reasoning as the port
    // labels above (a screen-space object rendered through THIS camera
    // still gets crushed by its own zoom; drawn oversized in world units
    // instead, inset from the map's own (0,0) corner, which the minimap
    // always shows fixed at its own top-left since minimapCam never
    // scrolls). No resize handling needed for the same reason miniDot
    // doesn't need any — its world position never changes.
    const compassGfx = this.add.graphics().setDepth(1000)
    compassGfx.lineStyle(40, 0xd9a441, 1)
    compassGfx.strokeCircle(420, 420, 260)
    compassGfx.fillStyle(0xd9a441, 1)
    compassGfx.fillPoints([{ x: 420, y: 340 }, { x: 460, y: 420 }, { x: 420, y: 500 }, { x: 380, y: 420 }], true)
    this.cameras.main.ignore(compassGfx)

    // The frame/compass are screen-fixed HUD elements for the main camera
    // only, and the water tile is purely a main-view backdrop (at minimap
    // zoom its wave lines would just alias into noise) — the minimap camera
    // must ignore both, or the frame draws as a giant shape over the whole
    // minimap and the water washes out its own flat tone. The compass is
    // NOT in this list on purpose — it's world-space now (see its own
    // comment above) and needs to render THROUGH this camera, not be
    // excluded from it.
    this.minimapCam.ignore([
      this.minimapFrame, this.waterTile,
      this.hpText, this.coordText, this.myNameText, this.myNameCard, this.myHpBar.bg, this.myHpBar.fill,
    ])
  }

  /** Re-lays out the minimap after the canvas itself has resized (see handleResize) — otherwise it stays pinned to its create()-time corner and size while the rest of the HUD moves. */
  repositionMinimap() {
    if (!this.minimapCam) return
    const { size, x, y } = this.minimapLayout()
    this.drawMinimapFrame(x, y, size)
    this.minimapMaskShape.clear()
    this.minimapMaskShape.fillStyle(0xffffff)
    this.minimapMaskShape.fillRoundedRect(x, y, size, size, 10)
    this.minimapCam.setViewport(x, y, size, size)
    this.minimapCam.setZoom(size / MAP_SIZE)
  }

  /**
   * Scale Manager RESIZE mode (see the Phaser.Game config in WorldPage.vue)
   * already resizes the canvas element itself — this only has to catch up
   * the things that don't follow automatically: the main camera's viewport
   * (it stays at its create()-time size otherwise, leaving dead space down
   * one edge) and the minimap's screen-space position.
   */
  handleResize(gameSize) {
    this.cameras.main.setSize(gameSize.width, gameSize.height)
    this.repositionMinimap()
  }

  // 'left'/'right' here are screen-relative UI labels ('fireLeft'/'fireRight',
  // matching the touch buttons and the rebindable action names) — the
  // server's internal 'side' vector is inverted from that (see the note on
  // the mouse pointerdown handler above), translated right here so nothing
  // downstream needs to know about that inversion.
  //
  // Guarded by our own predicted cooldown (lastBroadsideFiredAt, set up in
  // create()) before sending anything — without this, mashing fire mid-reload
  // still sent 'fire' (which the server just silently drops) AND still called
  // onFireBroadside, which reset the HUD ring's animation to "just fired"
  // even though nothing actually did. The ring restarting with no shot to
  // show for it was the desync.
  fireBroadside(uiSide) {
    const now = Date.now()
    if (now - this.lastBroadsideFiredAt[uiSide] < FIRE_COOLDOWN_MS) return
    this.lastBroadsideFiredAt[uiSide] = now
    this.room.send('fire', { side: uiSide === 'fireLeft' ? 'right' : 'left' })
    this.onFireBroadside?.(uiSide)
  }

  /** Is a gamepad currently holding down whatever button this action is bound to — same bindings.gamepad lookup controls.js's own press-edge polling uses, just read as a live state instead of an edge. */
  gamepadButtonHeld(action) {
    const pad = controls.firstGamepad()
    if (!pad) return false
    const btnIndex = controls.bindings.gamepad[action]
    return !!pad.buttons[btnIndex]?.pressed
  }

  /**
   * Screen-space unit vector the cone/cannonball for this broadside points
   * along — identical math to spawnCannonball's dir (kept in sync
   * deliberately, not shared, since spawnCannonball works off a server
   * 'side' label while this works off the UI-facing action name).
   */
  broadsideDirection(uiSide) {
    const fx = Math.sin(this.ship.rotation)
    const fy = -Math.cos(this.ship.rotation)
    // uiSide 'fireLeft' sends server side 'right' (see fireBroadside) — same
    // inversion applied here so the cone points the same way the ball flies.
    return uiSide === 'fireLeft' ? { x: fy, y: -fx } : { x: -fy, y: fx }
  }

  /**
   * Hold-to-aim polling, run every frame from update(). A broadside input
   * counts as "held" if ANY input method says so (only one is ever actually
   * in use at a time per player, but all are always polled so switching
   * devices mid-session just works). On the release edge the shot actually
   * fires — reuses fireBroadside's own cooldown guard, so holding past a
   * ready reload and releasing early doesn't bypass it.
   *
   * Firing is blocked in port territory (see isNearAnyPort in WorldRoom.js)
   * — this.currentNearPortId (set by checkNearPort, run just before this
   * every frame) is this client's own copy of that same check. While
   * docked, holding never draws a cone (there'd be nothing honest to show —
   * the server will refuse the shot regardless of where it's aimed), and
   * releasing shows a toast instead of actually firing, so mashing the
   * button in port never sends a single 'fire' the server would've had to
   * silently drop, and the reload ring never fakes a shot that didn't
   * happen (see fireBroadside's own note on that exact desync).
   */
  updateAiming() {
    const inPort = this.currentNearPortId !== null
    for (const uiSide of ['fireLeft', 'fireRight']) {
      const held =
        controls.isDown(uiSide) ||
        this.gamepadButtonHeld(uiSide) ||
        controls.isTouchHeld(uiSide) ||
        (uiSide === 'fireLeft' ? this.input.activePointer.leftButtonDown() : this.input.activePointer.rightButtonDown())

      if (held && !inPort) {
        this.drawAimCone(uiSide)
      } else {
        this.aimCones[uiSide].clear()
      }

      if (!held && this.wasHeld[uiSide]) {
        if (inPort) this.onActionRejected?.('Нельзя стрелять на территории порта')
        else this.fireBroadside(uiSide)
      }
      this.wasHeld[uiSide] = held
    }
  }

  /**
   * Called from WorldPage.vue's activePortId watch — true while PortModal
   * is open. Resets wasHeld on lock so a fire input that was mid-press the
   * instant the modal opened doesn't read as a "release" (and fire) the
   * moment it's unlocked again; movement/aiming/firing themselves are
   * skipped in update() while this is true (see the inputLocked check
   * there), this just handles the immediate visual cleanup.
   */
  setInputLocked(locked) {
    this.inputLocked = locked
    if (!locked) return
    this.ship.setVelocity(0, 0)
    for (const uiSide of ['fireLeft', 'fireRight']) {
      this.aimCones[uiSide].clear()
      this.wasHeld[uiSide] = false
    }
  }

  /**
   * Redraws one broadside's aim preview for the current frame — cleared and
   * redrawn every frame it's held since the ship (its origin and facing)
   * keeps moving. Shows exactly what's about to fire: a thin ray per
   * individual cannon on that side (this ship's real gun count — see
   * SHIP_CANNON_COUNT), fanned across the same CANNON_SPREAD_HALF_ANGLE the
   * server actually fires with, each as long as the last known real range
   * (see lastKnownRange), plus a faint wash across the whole spread so the
   * covered zone still reads at a glance even with a lot of thin rays.
   */
  drawAimCone(uiSide) {
    const dir = this.broadsideDirection(uiSide)
    const baseAngle = Math.atan2(dir.y, dir.x)
    const range = this.lastKnownRange[uiSide]
    const shipType = this.meRef?.shipType ?? 'boat'
    const totalCannons = SHIP_CANNON_COUNT[shipType] ?? SHIP_CANNON_COUNT.boat
    const count = Math.max(1, Math.floor(totalCannons / 2))

    const cone = this.aimCones[uiSide]
    cone.clear()

    // Wash across the full spread first, so it sits behind the rays.
    const edgeLeft = { x: this.ship.x + Math.cos(baseAngle - CANNON_SPREAD_HALF_ANGLE) * range, y: this.ship.y + Math.sin(baseAngle - CANNON_SPREAD_HALF_ANGLE) * range }
    const edgeRight = { x: this.ship.x + Math.cos(baseAngle + CANNON_SPREAD_HALF_ANGLE) * range, y: this.ship.y + Math.sin(baseAngle + CANNON_SPREAD_HALF_ANGLE) * range }
    cone.fillStyle(0xf0c96b, 0.14)
    cone.beginPath()
    cone.moveTo(this.ship.x, this.ship.y)
    cone.lineTo(edgeLeft.x, edgeLeft.y)
    cone.lineTo(edgeRight.x, edgeRight.y)
    cone.closePath()
    cone.fillPath()

    // One ray per real cannon — the actual "веер" (fan) of guns about to
    // fire, same even spacing as spawnBroadsideVolley/handleFire use.
    cone.lineStyle(1.5, 0xf0c96b, 0.75)
    cone.beginPath()
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5 // -0.5..0.5
      const angle = baseAngle + t * 2 * CANNON_SPREAD_HALF_ANGLE
      cone.moveTo(this.ship.x, this.ship.y)
      cone.lineTo(this.ship.x + Math.cos(angle) * range, this.ship.y + Math.sin(angle) * range)
    }
    cone.strokePath()
  }

  /**
   * Dark rounded card behind a ship's name + HP bar, drawn in LOCAL space
   * around (0,0) — position it like any other game object with
   * setPosition(shipX, shipY + card.yOffset) (yOffset is stashed on the
   * returned object since it depends on this particular name's text
   * height). Width fits the actual name (names vary a lot in length); the
   * rest of the geometry is fixed, since every name renders at the same
   * NAME_TEXT_STYLE font size regardless of what it says.
   */
  createNameCard(nameText) {
    const padX = 10
    const padTop = 3
    const padBottom = 4
    const width = Math.max(nameText.width, HP_BAR_WIDTH) + padX * 2
    const top = -28 - nameText.height - padTop
    const bottom = -21 + HP_BAR_HEIGHT / 2 + padBottom
    const height = bottom - top
    const card = this.add.graphics().setDepth(9) // behind the name (10) and hp bar (10/11) it backs
    card.fillStyle(0x06141a, 0.68)
    card.fillRoundedRect(-width / 2, -height / 2, width, height, 7)
    card.yOffset = (top + bottom) / 2
    return card
  }

  /**
   * A dark backing rect plus a colored fill rect, both left-anchored
   * (origin 0, 0.5) so the fill shrinks from the right as HP drops instead
   * of staying centered — the usual game-HUD HP-bar convention. Shared by
   * the player's own ship and every other ship (bots included) — same
   * visual, same math, just fed a different live HP source each frame (see
   * updateHpBar).
   */
  createHpBar(x, y) {
    const bg = this.add.image(x, y, 'hp-bar-bg').setOrigin(0, 0.5).setDepth(10)
    const fill = this.add.image(x, y, 'hp-bar-fill-good').setOrigin(0, 0.5).setDepth(11)
    fill.setCrop(0, 0, HP_BAR_WIDTH, HP_BAR_HEIGHT)
    return { bg, fill }
  }

  updateHpBar(bar, shipX, shipY, hp, maxHp) {
    const barX = shipX - HP_BAR_WIDTH / 2
    const barY = shipY + HP_BAR_Y_OFFSET
    bar.bg.setPosition(barX, barY)
    bar.fill.setPosition(barX, barY)

    const fraction = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0
    // Green/amber/red at a glance — matches the same thresholds as the
    // HP number itself would read at, no need to also read the digits to
    // tell "fine" from "about to sink" from across the map. A texture swap
    // (not a tint) so the rounded-pill fill stays crisp at every color —
    // only actually swaps when the threshold's crossed, not every frame.
    const fillKey = fraction > 0.5 ? 'hp-bar-fill-good' : fraction > 0.25 ? 'hp-bar-fill-mid' : 'hp-bar-fill-bad'
    if (bar.fill.texture.key !== fillKey) bar.fill.setTexture(fillKey)
    bar.fill.setCrop(0, 0, HP_BAR_WIDTH * fraction, HP_BAR_HEIGHT)
  }

  checkNearPort() {
    const nearby = this.ports.find((p) => Math.hypot(p.x - this.ship.x, p.y - this.ship.y) <= PORT_ENTER_RANGE)
    const nearbyId = nearby?.id ?? null

    if (nearbyId !== this.currentNearPortId) {
      this.currentNearPortId = nearbyId
      this.onNearPortChange(nearby ?? null)
    }
  }

  checkNearBot() {
    let nearby = null
    for (const [sessionId, sprite] of this.otherShips) {
      if (!sprite.isBot) continue
      if (Math.hypot(sprite.x - this.ship.x, sprite.y - this.ship.y) <= ABORDAGE_RANGE) {
        nearby = { sessionId, firstName: sprite.firstName, shipType: sprite.shipType }
        break
      }
    }
    const nearbyId = nearby?.sessionId ?? null

    if (nearbyId !== this.currentNearBotId) {
      this.currentNearBotId = nearbyId
      this.onNearBotChange(nearby)
    }
  }

  checkNearHuman() {
    let nearby = null
    for (const [sessionId, sprite] of this.otherShips) {
      if (sprite.isBot) continue
      if (Math.hypot(sprite.x - this.ship.x, sprite.y - this.ship.y) <= ABORDAGE_RANGE) {
        nearby = { sessionId, firstName: sprite.firstName }
        break
      }
    }
    const nearbyId = nearby?.sessionId ?? null

    if (nearbyId !== this.currentNearHumanId) {
      this.currentNearHumanId = nearbyId
      this.onNearHumanChange(nearby)
    }
  }
}

// Laravel's port endpoints (PortController/GunsmithController) check this
// player's x/y straight from the `ships` table, which is normally only as
// fresh as the last AUTOSAVE_INTERVAL_MS(10s) tick — the old routed
// '/port/:id' page got a free fresh save for this exact reason (leaving the
// room to navigate there triggered WorldRoom's own onLeave save). A port
// visit no longer leaves the room at all (see PortModal's own comment), so
// this explicitly asks the server to save first and waits for its ack
// before opening the modal — otherwise a player who just arrived could get
// wrongly told they're "not at this port" for up to 10 seconds. Bounded by
// a timeout so a lost ack still opens the modal rather than doing nothing;
// worst case Laravel's own proximity check rejects it and the modal closes
// itself the same way it always has for a stale/invalid open.
function waitForPositionSaved() {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      unsub()
      resolve()
    }
    const unsub = room.onMessage('position_saved', finish)
    room.send('save_position')
    setTimeout(finish, 1500)
  })
}

async function enterPort() {
  if (!nearPort.value) return
  const portId = nearPort.value.id
  await waitForPositionSaved()
  activePortId.value = portId
}

function enterAbordage() {
  if (nearBot.value) router.push({ path: '/abordage/pve', query: { botShipType: nearBot.value.shipType, botName: nearBot.value.firstName } })
}

function challengeHuman() {
  // No local navigation here — both participants get redirected together
  // once the server confirms the fight (see onAbordageStarted below), not
  // just whoever clicked.
  if (nearHuman.value) room.send('abordage_challenge', { targetSessionId: nearHuman.value.sessionId })
}

// The original's Info_Form, opened with the same 'I' key — ship, captain
// (boarding stats), and hold in one glance. A non-blocking overlay rather
// than a modal dialog: the world keeps running underneath, closer to how a
// HUD panel behaves in a real-time game than the original's blocking form.
async function toggleInfo() {
  showInfo.value = !showInfo.value
  if (!showInfo.value) return

  const { ship, coins: gold } = await api.getShip()
  shipInfo.value = ship
  coins.value = gold
}

// The single rebindable 'action' button standing in for whatever the
// context-prompt (below) is currently announcing — this is what makes the
// interaction reachable from a keyboard, gamepad, or the touch button, not
// just a mouse click on the prompt itself. Priority when more than one is in
// range at once: a fight (human, then bot) before casually strolling into
// port — tight-range combat proximity is rarer and more deliberate than
// just happening to be within the wide port radius too.
// Only ever fires for gold/products THIS client actually reached and
// claimed (see claimCargoDrop in WorldRoom.js) — never just for landing
// the killing blow, so there's no "someone else beat you to it" case to
// silently handle here; if nothing was claimed, nothing is sent at all.
function notifyCargoClaimed(gold, products) {
  const parts = []
  if (gold > 0) parts.push(`${gold} золота`)
  for (const [type, qty] of Object.entries(products || {})) {
    if (qty > 0) parts.push(`${PRODUCT_NAMES[type] ?? type} ×${qty}`)
  }
  if (parts.length === 0) return
  Notify.create({ type: 'positive', message: `Вы подобрали груз: ${parts.join(', ')}`, position: 'top' })
}

// Was a Phaser text tween floating over the ship — sat right where the
// ship's own name plate + HP bar are drawn (see createNameCard/updateHpBar
// in WorldScene, both depth 9-11), so at the default depth it got hidden
// behind them. A real Quasar notification lives in its own DOM layer above
// the canvas entirely, so it can never be covered by anything drawn in it.
function notifyActionRejected(message) {
  Notify.create({ type: 'negative', message, position: 'top' })
}

function performAction() {
  // Port first — PORT_ENTER_RANGE (220) is much wider than ABORDAGE_RANGE
  // (70), so standing at a port with another ship right next to you used
  // to still offer/attempt abordage, which the server always rejects
  // inside port territory anyway (see isNearAnyPort in WorldRoom.js). That
  // meant the one button press could only ever fail, while silently
  // hiding the port entry that would have actually worked.
  if (nearPort.value) enterPort()
  else if (nearHuman.value) challengeHuman()
  else if (nearBot.value) enterAbordage()
}

// Same priority as performAction() above, by construction — this only
// decides what the notice SAYS, performAction alone decides what pressing
// Действие actually DOES, so the two can never disagree with each other.
const contextPrompt = computed(() => {
  if (nearPort.value) return { text: `Войти в порт «${nearPort.value.name}»` }
  if (nearHuman.value) return { text: `Абордаж — ${nearHuman.value.firstName} (игрок)` }
  if (nearBot.value) return { text: `Абордаж — ${nearBot.value.firstName}` }
  return null
})

onMounted(async () => {
  stopGamepadWatch = onGamepadChange(() => { showTouchControls.value = isPhone() && !controls.firstGamepad() })

  const [, { ports }] = await Promise.all([
    joinWorld().then((r) => (room = r)),
    api.listPorts(),
  ])

  // Server-side takeover: the same account just joined from another device
  // (see WorldRoom.onJoin) — this session's ship was already saved and
  // dropped from the room, all that's left is to get out of a now-dead
  // scene and explain why. Not the same case onBeforeUnmount's plain
  // room.leave() covers, which never sends this message.
  room.onMessage('kicked', () => {
    game?.destroy(true)
    router.replace({ path: '/', query: { kicked: '1' } })
  })

  // The initial state snapshot (room.state.players, populated in onJoin
  // server-side) arrives as a separate message right after the join
  // resolves — reading it before this fires is a race, not a guarantee.
  await new Promise((resolve) => room.onStateChange.once(resolve))

  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container.value,
    // RESIZE mode ties the canvas to the parent div's actual CSS size via a
    // ResizeObserver, not just its size at creation — without it the canvas
    // was a fixed bitmap frozen at whatever container.clientWidth/Height
    // happened to be on mount, so opening/closing devtools, rotating a
    // phone, or the Telegram WebView's async viewport expand all left it
    // stuck at the old size with dead space down one side.
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: container.value.clientWidth,
      height: container.value.clientHeight,
    },
    backgroundColor: '#0e3b4d',
    physics: { default: 'arcade', arcade: { debug: false } },
    audio: { noAudio: true },
  })
  game.scene.add('world', WorldScene, true, {
    room,
    ports,
    onNearPortChange: (port) => { nearPort.value = port },
    onNearBotChange: (bot) => { nearBot.value = bot },
    onNearHumanChange: (human) => { nearHuman.value = human },
    onCargoClaimed: notifyCargoClaimed,
    onActionRejected: notifyActionRejected,
    onAbordageStarted: (abordageId) => { router.push(`/abordage/${abordageId}`) },
    onActionPress: performAction,
    onInventoryPress: toggleInfo,
    onBackPress: () => router.push('/'),
    onFireBroadside: noteBroadsideFired,
  })
})

// Locks WorldScene's own movement+firing input for as long as PortModal is
// open (see setInputLocked there) — without this, WASD/gamepad/touch input
// still reaches the scene underneath a modal that visually covers it,
// letting a player sail off or fire mid-purchase. Symmetric by construction:
// whatever opens/closes activePortId (enterPort, the modal's own 'close')
// automatically locks/unlocks, so the two can never end up out of sync.
//
// Closing also tells the room to refresh this player's hp/shipType/cannon
// levels from the DB (see 'refresh_ship' in WorldRoom.js) — repairing,
// buying a new hull, or upgrading a cannon all happen over plain Laravel
// HTTP calls the realtime room never sees, so without this the world would
// keep showing your pre-repair HP bar, old hull, and un-upgraded cannons
// until you fully disconnected and reconnected (which is exactly what used
// to paper over this before Port became a modal that never leaves the room).
watch(activePortId, (id, prevId) => {
  game?.scene.getScene('world')?.setInputLocked(!!id)
  if (!id && prevId) room.send('refresh_ship')
})

onBeforeUnmount(() => {
  stopGamepadWatch?.()
  room?.leave()
  game?.destroy(true)
  if (cooldownRaf) cancelAnimationFrame(cooldownRaf)
})
</script>

<style scoped>
.context-prompt {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100% - 32px);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-radius: 999px;
  background: rgba(6, 20, 24, 0.85);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  z-index: 12;
}
.context-prompt__hint {
  flex: none;
  color: var(--c-gold-bright);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Broadside готовность/перезарядка — всегда на экране (не только тач):
   геймпад/клавиатурный игрок так же не видел раньше, готов ли борт стрелять.
   Кольцо красит сам conic-gradient в inline style (см. broadsideRingStyle),
   тут только форма и подложка под иконку. */
.broadside-hud {
  position: absolute;
  right: calc(16px + env(safe-area-inset-right, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex;
  gap: 10px;
  z-index: 15;
}
.broadside-ring {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  padding: 0;
  border: none;
  cursor: pointer;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.broadside-ring__inner {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(6, 20, 24, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
}
.broadside-ring__inner svg { width: 22px; height: 22px; }

/*
 * The wrapper spans the whole page but stays click-through (pointer-events:
 * none) — only the stick and the buttons themselves re-enable it. Without
 * that, this being on top of everything (it has to be, to sit above the
 * canvas) would also swallow taps meant for the context prompt in the
 * middle of the screen.
 */
.touch-controls {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 15;
}
.touch-controls__stick {
  position: absolute;
  left: calc(20px + env(safe-area-inset-left, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  pointer-events: auto;
}
.touch-btn {
  pointer-events: auto;
  position: absolute;
  /* Sits directly above the right-hand broadside ring — both anchored off
     the same right edge, so this stays aligned to it at any screen size. */
  right: calc(16px + env(safe-area-inset-right, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px) + 76px);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  color: var(--c-ink);
  font-family: var(--font-body);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
  padding: 4px;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  border: 1px solid rgba(217, 164, 65, 0.4);
  background: rgba(6, 20, 24, 0.6);
}

/*
 * .world-page's own box height is left to Quasar's QPage component — it
 * measures the real header height in JS and sizes the page to fit below it,
 * which sidesteps the classic mobile-Safari 100vh problem (100vh alone
 * measures the "address bar hidden" viewport, not what's actually visible,
 * so anything sized or anchored off it — the joystick, the fire buttons —
 * ended up positioned below the real fold). Setting an explicit height here
 * would just fight that JS measurement instead of using it.
 *
 * .world-frame used to cap itself to a centered, letterboxed box — traded
 * for full-bleed per explicit direction: fullscreen edge-to-edge, HUD
 * elements (context-prompt included) just sit wherever they sit on however
 * big the window is, same as most fullscreen web games. inset:0 with no
 * max-width/height just makes the frame fill .world-page exactly.
 */
.world-page {
  padding: 0;
  background: var(--c-bg-deep);
}
.world-frame {
  position: absolute;
  inset: 0;
}
.world-canvas { width: 100%; height: 100%; }
</style>
