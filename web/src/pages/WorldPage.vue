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
        Replaces the app-wide header's back arrow, which MainLayout.vue no
        longer renders on this route at all — every pixel of vertical
        space here actually matters (a fixed-position modal already fights
        mobile browser chrome for it, see PortModal.vue), and that header
        was the ONLY way a touch/mouse player without a bound gamepad/
        keyboard 'back' action could ever leave the world. Sits right next
        to the coordinate readout (both screen-fixed top-left) rather than
        reintroducing a full-width bar.
      -->
      <button class="world-exit-btn" @click="leaveWorld" aria-label="В меню">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
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

      <!-- Reload readout — always visible for keyboard/gamepad players (a
           phone shows the same progress folded into the Действие button's
           own background instead, see .touch-btn below, rather than showing
           it twice). A plain non-interactive gauge now that free aim's
           actual fire input lives elsewhere entirely (a mouse hold/release
           anywhere over the canvas, a gamepad's dedicated 'fire' button, or
           the touch aim stick + Действие) — clicking a fixed HUD element
           made sense when it doubled as the fire button, it doesn't anymore
           now that firing means aiming at the world, not at a screen
           corner. Hidden while PortModal is open — firing is locked then
           anyway (see the activePortId watch below), so a live ring here
           would just be a lie. -->
      <div v-if="!activePortId && !showTouchControls" class="broadside-hud">
        <div class="broadside-ring" :style="broadsideRingStyle(reloadFraction)">
          <span class="broadside-ring__inner">
            <svg viewBox="0 0 24 24" fill="none" :stroke="reloadFraction >= 1 ? 'var(--c-success)' : 'rgba(238,245,242,0.45)'" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="14" height="7" rx="3"/><circle cx="19" cy="12.5" r="4"/></svg>
          </span>
        </div>
      </div>

      <!-- Touch-only: a phone with no gamepad paired (see showTouchControls)
           gets on-screen sticks + buttons instead of relying on
           WASD/mouse/gamepad. Sits above the canvas, so a tap here never
           also reaches the canvas's own pointerdown-aims handler below.
           Left stick moves, right stick aims — hold to preview the hit
           cone, release to fire, same gesture as a held mouse button (see
           updateAiming) — Действие stays its plain context-action self, its
           own reload progress shown via the same background style anyway.
           Инвент sits in the same top-left row as the exit button and
           coordinates, not the top-right corner opposite it (see
           .touch-inventory-btn's own comment for why) — the only on-screen
           way to open the inventory on a phone (keyboard I / gamepad Y
           have no touch equivalent otherwise). -->
      <div v-if="showTouchControls && !activePortId" class="touch-controls">
        <TouchJoystick class="touch-controls__stick" />
        <TouchJoystick class="touch-controls__aim-stick" variant="aim" />
        <button class="touch-btn" :style="broadsideRingStyle(reloadFraction)" @pointerdown.prevent="controls.touchPress('action')">Действие</button>
        <button class="touch-inventory-btn" @pointerdown.prevent="controls.touchPress('inventory')" aria-label="Инвентарь">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>
        </button>
      </div>

      <ShipInfoOverlay v-if="showInfo" :ship-info="shipInfo" :coins="coins" @close="showInfo = false" />

      <DeathPenaltyModal :summary="deathSummary" @close="deathSummary = null" />

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
      <PortModal
        v-if="activePortId"
        :key="activePortId"
        :port-id="activePortId"
        @close="activePortId = null"
        @ship-changed="onShipChanged"
      />
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
import { api, setToken } from '@/services/api'
import { controls, isPhone, onGamepadChange } from '@/services/controls'
import ShipInfoOverlay from '@/components/ShipInfoOverlay.vue'
import TouchJoystick from '@/components/TouchJoystick.vue'
import PortModal from '@/components/PortModal.vue'
import DeathPenaltyModal from '@/components/DeathPenaltyModal.vue'

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
// { lostGold, lostProducts, lostSailors } while the death-penalty popup is
// open, null otherwise — set by the 'death_penalty' handler in
// setupNetworking (see notifyDeathPenalty), cleared by the modal's own
// 'close'. A toast doesn't give a real setback this weight; this is
// something the player has to actually acknowledge (see DeathPenaltyModal).
const deathSummary = ref(null)

// Reload readiness — 0 = только что выстрелил, 1 = готов. One shared ring
// now that the whole gun deck fires together (see broadsideCannons in
// WorldRoom.js) instead of two independent broadsides. Optimistic/predicted
// from the moment 'fire' is sent (see fireFree in WorldScene below), not
// confirmed by the server — the server enforces the real cooldown
// independently and just silently ignores an early shot, so worst case
// this ring is briefly wrong instead of the fire being blocked.
const firedAt = ref(0)
const cooldownTick = ref(0)
let cooldownRaf = null
function pumpCooldownTick() {
  cooldownTick.value = Date.now()
  const stillCooling = Date.now() - firedAt.value < FIRE_COOLDOWN_MS
  cooldownRaf = stillCooling ? requestAnimationFrame(pumpCooldownTick) : null
}
function noteBroadsideFired() {
  firedAt.value = Date.now()
  if (!cooldownRaf) cooldownRaf = requestAnimationFrame(pumpCooldownTick)
}
const reloadFraction = computed(() => {
  void cooldownTick.value
  return Math.min(1, (Date.now() - firedAt.value) / FIRE_COOLDOWN_MS)
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
// A phone (portrait OR landscape — see computeCameraZoom's own use of
// Math.min) shows noticeably less world at zoom 1 than the desktop window
// this was designed against, and the on-screen joystick/action buttons eat
// further into what's left (direct feedback, screenshots comparing the
// two). Zooming out on a small screen buys back some of that — 700 is
// roughly a small-tablet's shorter side, so anything phone-sized clamps to
// the 0.7 floor and anything tablet-or-bigger stays at a full 1.
const CAMERA_ZOOM_REFERENCE = 700
const CAMERA_ZOOM_MIN = 0.7
const SHIP_SPEED = 220
// Keep in sync with SHIP_SPEED_MULT in realtime/src/rooms/WorldRoom.js and
// the `speed` column in config/ships.php.
const SHIP_SPEED_MULT = {
  boat: 0.75, schooner: 0.75, caravel: 0.75, brig: 0.75,
  frigate: 1.0, galleon: 1.25, corvette: 2.0, battleship: 1.5,
}
// A damaged hull sails slower — torn sails, a battered rudder, that kind
// of thing (direct request: "после боя корабль медленнее плывет"). Linear
// from full speed at full HP down to this floor at 0 HP, not all the way
// to a dead stop — a ship that's actually losing a fight needs speed to
// disengage MORE than a healthy one does, not less; a floor near 0 would
// turn "badly hurt" into "can't run either", the exact opposite of what
// the flee-to-port mechanic (see WorldRoom.js) already exists to let a
// damaged ship do. Applied client-side only, same trust model movement
// already has (see the 'move' handler in WorldRoom.js — fully
// client-authoritative, this doesn't change that).
const HP_SPEED_DEBUFF_FLOOR = 0.5
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
// how many individual cannons fan out in one volley (the whole deck now,
// see broadsideCannons server-side). Only used to size the aim preview (see
// drawAimCone) before this player's first real shot has confirmed anything
// with the server; it's never trusted for actual hit resolution.
const SHIP_CANNON_COUNT = {
  boat: 6, schooner: 10, caravel: 14, brig: 16,
  frigate: 20, galleon: 24, corvette: 18, battleship: 30,
}

// Keep in sync with CANNON_SPREAD_HALF_ANGLE in
// realtime/src/rooms/WorldRoom.js — how far each individual gun in the
// volley fans out from dead-center, in radians. Purely cosmetic here (see
// drawAimCone/spawnBroadsideVolley); the server resolves every ball's real
// flight path independently and never reads this copy.
const CANNON_SPREAD_HALF_ANGLE = 0.32

// Deadzone for the free-aim sources that report a continuous vector
// (gamepad right stick, the on-screen aim stick) — below this magnitude
// the source counts as "not aiming" rather than jittering toward whatever
// tiny drift its resting position happens to read. Kept local to aiming
// (movement's own deadzone lives in controls.js's STICK_DEADZONE) since the
// two inputs have different tolerances for a false-positive.
const STICK_AIM_DEADZONE = 0.2

// Keep in sync with CARGO_DROP_TTL_MS in realtime/src/rooms/WorldRoom.js —
// purely cosmetic here (the server deletes the drop from state on its own
// schedule regardless of what this draws), just needs to agree so the ring
// hits empty around the same moment the crate actually disappears.
const CARGO_DROP_TTL_MS = 120000

// Must match SHORE_POINT_COUNT in realtime/src/worldgen.js — how many
// boundary samples each synced island's `points` array carries.
const SHORE_POINT_COUNT = 16
const MINIMAP_MARGIN = 12
// Keep in sync with .world-exit-btn's own CSS position/size — same row as
// the exit button (to its right, roughly vertically centered against it)
// instead of stacked underneath, which cost an extra line of height this
// corner didn't have to spend.
const COORD_TEXT_X = 56
const COORD_TEXT_Y = 20

// Keep in sync with config/ships.php's key order.
const SHIP_TYPES = ['boat', 'schooner', 'caravel', 'brig', 'frigate', 'galleon', 'corvette', 'battleship']
// Keep in sync with the 'name' field of each entry in config/ships.php.
const SHIP_TYPE_NAMES = {
  boat: 'Шлюпка', schooner: 'Шхуна', caravel: 'Каравелла', brig: 'Бриг',
  frigate: 'Фрегат', galleon: 'Галеон', corvette: 'Корвет', battleship: 'Линкор',
}
const NAME_TEXT_STYLE = { fontSize: '12px', color: '#ffffff', stroke: '#0a1f28', strokeThickness: 3 }
// Keep in sync with config/products.php's 'name' field — used for the
// Notify toast text on a cargo pickup (see onCargoClaimed) and the death
// penalty popup's loss breakdown (see the 'death_penalty' handler).
const PRODUCT_NAMES = {
  rum: 'Ром', silk: 'Шёлк', water: 'Вода', food: 'Еда',
  leather: 'Кожа', wood: 'Дерево', tobacco: 'Табак', coffee: 'Кофе',
}
// Keep in sync with config/products.php's 'weight' field — used to bump
// the cargo-hold bar (see addCargoWeight) the instant a cargo drop is
// claimed, without waiting on a fresh api.getShip() round trip.
const PRODUCT_WEIGHTS = { rum: 1, silk: 2, water: 1, food: 1, leather: 10, wood: 20, tobacco: 3, coffee: 7 }
const HP_BAR_WIDTH = 36
const HP_BAR_HEIGHT = 5
// Between the ship and its name label (name sits at -28) — reads as
// "belongs to this ship" without overlapping either.
const HP_BAR_Y_OFFSET = -21
const CARGO_BAR_HEIGHT = 4
// Directly under the HP bar, own ship only — nobody else's cargo weight is
// even known client-side (Player schema never carried it, see setCargo's
// own comment), so there's nothing to draw for other ships anyway.
const CARGO_BAR_Y_OFFSET = HP_BAR_Y_OFFSET + HP_BAR_HEIGHT + 2

function shipLabel(name, shipType) {
  return `${name} (${SHIP_TYPE_NAMES[shipType] ?? shipType})`
}

/**
 * Nearest positive distance along the ray (ox, oy) + t*(dx, dy) where it
 * enters the circle centered at (cx, cy) with the given radius, or null if
 * it never does. (dx, dy) must already be a unit vector. Used by
 * WorldScene.rayObstructionDistance for the aim-hold preview.
 */
function rayCircleHit(ox, oy, dx, dy, cx, cy, radius) {
  const fx = ox - cx
  const fy = oy - cy
  const b = fx * dx + fy * dy
  const c = fx * fx + fy * fy - radius * radius
  if (c <= 0) return 0 // origin already inside — stops immediately
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t > 0 ? t : null
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
// Keep in sync with CANNONBALL_HIT_RADIUS in realtime/src/rooms/WorldRoom.js
// — used only to stop the aim-hold preview's rays at a ship they'd actually
// hit (see drawAimCone/rayObstructionDistance), not real hit detection.
const AIM_RAY_SHIP_RADIUS = 26
// Sampling step for the aim ray's island check (see rayObstructionDistance)
// — islands are irregular, not circles, so unlike the ship/port checks
// there's no clean analytic intersection; marches in short steps and stops
// at the first blocked sample instead, same idea as WorldRoom.js's own
// pathClear.
const AIM_RAY_STEP = 20

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
    this.onDeathPenalty = data.onDeathPenalty
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

    // A live rotation (no page reload) proved unreliable on iOS Chrome —
    // the Scale Manager's own ResizeObserver either doesn't fire or fires
    // with a stale/transitional container size right after
    // orientationchange, leaving the camera/canvas resolution stuck at the
    // pre-rotation size while CSS has already resized the container
    // (reported as the view rendering zoomed into the wrong portion of the
    // world post-rotation — only a reload, which re-measures from scratch,
    // fixed it). scale.refresh() forces an explicit re-measure instead of
    // trusting whatever the automatic ResizeObserver did; delayed since
    // window.innerWidth/Height and the container's own layout are still
    // settling for a moment right after the event fires.
    this.orientationHandler = () => setTimeout(() => this.scale.refresh(), 300)
    window.addEventListener('orientationchange', this.orientationHandler)

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

    // Same pill shape as the HP bar, one plain white fill (no good/mid/bad
    // tiering — a full hold isn't "bad," it just means go sell) — see
    // createCargoBar/updateCargoBar.
    const cargoBarBgTexture = this.make.graphics({ x: 0, y: 0 })
    cargoBarBgTexture.fillStyle(0x0b1a1f, 0.85)
    cargoBarBgTexture.fillRoundedRect(0, 0, HP_BAR_WIDTH, CARGO_BAR_HEIGHT, CARGO_BAR_HEIGHT / 2)
    cargoBarBgTexture.generateTexture('cargo-bar-bg', HP_BAR_WIDTH, CARGO_BAR_HEIGHT)
    cargoBarBgTexture.destroy()
    const cargoBarFillTexture = this.make.graphics({ x: 0, y: 0 })
    cargoBarFillTexture.fillStyle(0xf4f4f2, 1)
    cargoBarFillTexture.fillRoundedRect(0, 0, HP_BAR_WIDTH, CARGO_BAR_HEIGHT, CARGO_BAR_HEIGHT / 2)
    cargoBarFillTexture.generateTexture('cargo-bar-fill', HP_BAR_WIDTH, CARGO_BAR_HEIGHT)
    cargoBarFillTexture.destroy()

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

    // Faint DASHED ring on the water at PORT_ENTER_RANGE around each port —
    // same radius the server actually gates firing/abordage/bot-aggro on
    // (isNearAnyPort in WorldRoom.js), drawn once (ports never move) so a
    // player can actually SEE the safe zone's edge instead of only
    // learning where it is by getting shot at right up to the line. A
    // perfect solid circle read as a radar/debug overlay against the
    // hand-drawn water and coastline (direct feedback) — dashed, plus a
    // small per-port wobble on the radius (same idea as the islands' own
    // organic, not-quite-circular coastline), reads as a chart marking
    // instead. A port sits right at a shoreline too, so a plain full
    // circle would cut straight across the island behind it — sampled
    // around the circle instead, stroking only the (water AND dash-on)
    // runs, leaving a gap both wherever it crosses land and between dashes.
    this.portSafeZoneRings = []
    const RING_DASH = 16
    const RING_GAP = 12
    for (const port of this.ports) {
      const ring = this.add.graphics().setDepth(1)
      ring.lineStyle(2, 0x9fe3a0, 0.3)
      const steps = 200
      const wobbleSeed = Math.random() * Math.PI * 2
      let drawing = false
      let arcLen = 0
      let prevX = null
      let prevY = null
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2
        const wobble = 8 * Math.sin(angle * 3 + wobbleSeed) + 4 * Math.sin(angle * 7 + wobbleSeed * 1.7)
        const radius = PORT_ENTER_RANGE + wobble
        const x = port.x + Math.cos(angle) * radius
        const y = port.y + Math.sin(angle) * radius
        if (prevX !== null) arcLen += Math.hypot(x - prevX, y - prevY)
        prevX = x
        prevY = y

        const shouldDraw = !this.collidesWithIsland(x, y) && arcLen % (RING_DASH + RING_GAP) < RING_DASH
        if (shouldDraw) {
          if (!drawing) {
            ring.beginPath()
            ring.moveTo(x, y)
            drawing = true
          } else {
            ring.lineTo(x, y)
          }
        } else if (drawing) {
          ring.strokePath()
          drawing = false
        }
      }
      if (drawing) ring.strokePath()
      this.portSafeZoneRings.push(ring)
    }

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
    // Stock per-type multiplier until the first refreshShipStats() (see
    // WorldPage.vue) resolves and corrects it via setSpeedMult — Паруса
    // (see config/rigging.php) isn't part of the Player schema, same
    // reasoning as cargo capacity not being either, so this starts as a
    // reasonable guess (right for anyone with no Паруса upgrade at all,
    // which is everyone on their very first ship) rather than the real
    // number from the instant the scene exists.
    this.speedMult = SHIP_SPEED_MULT[me?.shipType] ?? 1
    this.mySpeed = SHIP_SPEED * this.speedMult
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
    // Cargo weight/capacity aren't in the Player schema at all (see
    // setCargo's own comment) — starts at a harmless 0/1 until
    // refreshShipStats() in WorldPage.vue resolves its first api.getShip().
    // cargoReady gates addCargoWeight (see its own comment) — without it, a
    // cargo pickup landing before that first fetch resolves added a real
    // weight on top of the still-default capacity of 1, showing the bar as
    // briefly full/overflowing until the fetch caught up and corrected it.
    this.cargoWeight = 0
    this.cargoCapacity = 1
    this.cargoReady = false
    this.myCargoBar = this.createCargoBar(this.ship.x, this.ship.y + CARGO_BAR_Y_OFFSET)

    this.cameras.main.startFollow(this.ship, true, 0.1, 0.1)

    // HP used to have its own corner readout here too — dropped (direct
    // feedback: nobody's looking at a top-left number mid-fight) now that
    // the floating bar over the ship itself already shows it live every
    // frame (see updateHpBar in update()). Coordinates stayed — worth
    // reading off deliberately (sharing a position, navigating to a port),
    // not something you'd track by eye during combat the way HP is.
    // Pale text alone (like the old #bcd9d1) read fine over the water but
    // vanished against light sand whenever an island scrolled behind this
    // screen-fixed corner (direct feedback). Dark fill this time, same
    // stroke-outline trick NAME_TEXT_STYLE already uses just inverted —
    // readable over anything behind it, water or shore.
    this.coordText = this.add.text(COORD_TEXT_X, COORD_TEXT_Y, '', { fontSize: '13px', color: '#1a1410', stroke: '#f0ead6', strokeThickness: 3 })
    this.coordText.setScrollFactor(0)
    // Sets the real zoom on the camera (and repositions coordText for it)
    // before setupMinimap below draws the minimap frame — drawMinimapFrame
    // reads this.cameras.main.zoom itself, so it needs the real value
    // already in place for its very first draw, not just from whatever
    // resize happens to fire next.
    this.applyCameraZoom()

    this.setupMinimap()

    this.lastMoveSentAt = 0
    this.otherShips = new Map()
    this.cargoDropSprites = new Map() // dropId -> { crate, ring, x, y, spawnedAt }
    this.activeCannonballs = new Map() // attackerId -> array of in-flight ball sprites (a whole volley, see spawnBroadsideVolley)
    // Guards fireFree below — mashing fire mid-reload used to still reset
    // the HUD ring's animation (via onFireBroadside) even though no ball
    // actually flew, since the server silently drops the early 'fire' but
    // the client had no idea it was early and reset anyway.
    this.lastBroadsideFiredAt = 0

    // Free aim: mouse/gamepad-stick/touch-stick continuously feed an aim
    // angle (see updateAiming), previewed as a hit-zone cone. Mouse and the
    // touch stick fire on release (wasReleasableHeld tracks that edge); a
    // gamepad's stick is preview-only, fired instead by its own dedicated
    // button (see fireFreeAimButton). lastKnownRange starts at the boat
    // default and gets corrected the instant this player's own first
    // 'fired' broadcast arrives (see setupNetworking) — close enough for
    // the very first aim before that, and exact for every one after.
    this.wasReleasableHeld = false
    this.currentAimAngle = 0
    this.lastKnownRange = DEFAULT_AIM_RANGE
    // Set by setInputLocked (see WorldPage.vue's activePortId watch) while
    // PortModal is open — freezes movement/aiming/firing without tearing
    // down the scene or leaving the room, just like standing still.
    this.inputLocked = false
    // Translucent hit-zone cone, drawn/cleared each frame in update() while
    // actively aiming. Minimap must never show it — same reasoning as every
    // other screen-only HUD graphic.
    this.aimCone = this.add.graphics().setDepth(8)
    this.minimapCam?.ignore(this.aimCone)

    this.setupNetworking()

    // Left mouse button drives free aim directly (hold to preview, release
    // to fire — see updateAiming), read straight off Phaser's pointer state
    // rather than through the rebind system, same as it always was for
    // mouse buttons. Right-click stays disabled — no second use for it now.
    this.input.mouse?.disableContextMenu()

    // Rebindable keyboard/gamepad actions (see services/controls.js) — a
    // gamepad's 'fire' is a discrete press (unlike mouse's hold/release),
    // firing toward wherever its right stick currently points (or the
    // ship's own forward direction if the stick's centered — see
    // fireFreeAimButton). action/inventory/back stay discrete press events,
    // unchanged. Guarded by inputLocked too, not just the per-frame
    // movement/firing — PortModal has its OWN 'back'/'inventory' listeners
    // (see PortModal.vue) that are meant to close/open ITS overlay while
    // it's open; without this guard, the exact same button press would ALSO
    // hit these still-live World listeners underneath (onBackPress leaves
    // the world entirely — very much not what closing a shop dialog should
    // do).
    this.controlUnsubs = [
      controls.onPress('action', () => { if (!this.inputLocked) this.onActionPress?.() }),
      controls.onPress('inventory', () => { if (!this.inputLocked) this.onInventoryPress?.() }),
      controls.onPress('fire', () => { if (!this.inputLocked) this.fireFreeAimButton() }),
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
    const unsubscribeAll = () => {
      this.controlUnsubs.forEach((unsub) => unsub())
      window.removeEventListener('orientationchange', this.orientationHandler)
    }
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
      // Stock multiplier for the new type — same "reasonable guess until
      // refreshShipStats() corrects it" as create()'s own init, since a
      // hull swap (what actually triggers this) always resets Паруса to 0
      // anyway (see PortController::buyShip), so this guess happens to be
      // exactly right immediately after a purchase; only a same-hull
      // Паруса upgrade needs the later REST correction to actually show.
      this.speedMult = SHIP_SPEED_MULT[this.meRef.shipType] ?? 1
      this.mySpeed = SHIP_SPEED * this.speedMult
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

    this.room.onMessage('fired', ({ attackerId, angle, count, range, speed }) => {
      this.spawnBroadsideVolley(attackerId, angle, count, range, speed)
      // Corrects the aim cone's length to this player's real, possibly
      // upgraded, cannon range the moment it's actually known — see
      // lastKnownRange's setup in create().
      if (attackerId === this.room.sessionId) this.lastKnownRange = range
    })

    // Pushed on join and after anything that could change the deck's real
    // range (cannon upgrades, a new hull — see sendBroadsideStats in
    // WorldRoom.js) — without this, a freshly (re)joined client stayed on
    // the small DEFAULT_AIM_RANGE fallback even on a ship with a much
    // bigger real range, until it fired once itself. Same fix, just
    // proactive instead of only reactive to this player's own 'fired'
    // broadcasts above.
    this.room.onMessage('broadside_stats', ({ range }) => {
      if (range) this.lastKnownRange = range
    })
    // Asked for right here, the instant this listener is actually live —
    // a server-side push from onJoin used to do this instead, but it had
    // no way to know whether THIS client had gotten this far in Phaser
    // scene setup yet (a bare join is much faster than constructing the
    // whole scene), so on a plain page reload the message routinely beat
    // this handler here and was silently dropped — the very first shot
    // after a reload landing at the small DEFAULT_AIM_RANGE fallback
    // (direct feedback). Asking instead of waiting to be told removes the
    // race outright: this line cannot run before the listener above does.
    this.room.send('request_broadside_stats')

    this.room.onMessage('hit', ({ attackerId, targetId, damage }) => {
      // A broadside is now several independent balls (see
      // spawnBroadsideVolley) — this message is about exactly ONE of them
      // finding its mark, so only the visual ball nearest the target gets
      // cut short; the rest of the volley keeps flying toward its own miss.
      const targetX = targetId === mySessionId ? this.ship.x : this.otherShips.get(targetId)?.x
      const targetY = targetId === mySessionId ? this.ship.y : this.otherShips.get(targetId)?.y
      if (targetX !== undefined) this.stopNearestCannonball(attackerId, targetX, targetY)
      if (targetId === mySessionId) {
        this.spawnDamageNumber(this.ship.x, this.ship.y, damage)
      } else {
        // The floating "-NN" (see spawnDamageNumber) is the "just got hit"
        // signal now — a red screen flash / hull tint on top of it read as
        // redundant, per direct feedback.
        const targetSprite = this.otherShips.get(targetId)
        if (targetSprite) this.spawnDamageNumber(targetSprite.x, targetSprite.y, damage)
      }
    })

    // Оснастка's Такелаж (see resolveHit in WorldRoom.js) — a shot that
    // reached the target but got evaded, distinct from a clean miss (which
    // never reaches here at all, the ball just runs out of range). Same
    // "stop the one ball that resolved, leave the rest of the volley
    // flying" reasoning as 'hit', just a floating "Уворот" instead of a
    // damage number (see spawnFloatingText) — no HP change, nothing else to do.
    this.room.onMessage('dodged', ({ attackerId, targetId }) => {
      const targetX = targetId === mySessionId ? this.ship.x : this.otherShips.get(targetId)?.x
      const targetY = targetId === mySessionId ? this.ship.y : this.otherShips.get(targetId)?.y
      if (targetX !== undefined) this.stopNearestCannonball(attackerId, targetX, targetY)
      if (targetX !== undefined) this.spawnFloatingText(targetX, targetY, 'Уворот', '#9fd8ff')
    })

    // The server now actually stops a ball at the shoreline (see
    // tickCannonballs in WorldRoom.js) instead of letting shots pass through
    // islands — without this the client's blind visual tween would keep
    // flying straight through the land it just got blocked by. Only the one
    // ball that actually hit the shore at (x, y) stops — same reasoning as
    // 'hit' above, now that a volley is several independent balls.
    this.room.onMessage('cannonball_blocked', ({ attackerId, x, y }) => this.stopNearestCannonball(attackerId, x, y))

    this.room.onMessage('sunk', ({ targetId, respawnX, respawnY }) => {
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
      // Used to be baked into the now-removed corner hpText — reuses the
      // same Notify toast path as a rejected action (see onActionRejected)
      // rather than a dedicated callback just for this one rare event.
      // respawnHp itself needs no separate mention — the floating bar over
      // the ship already shows it live the instant this patch lands.
      this.onActionRejected?.('Потоплен — респавн у ближайшего порта')
    })

    // Arrives separately from 'sunk' above (its own async DB round-trip on
    // WorldRoom's side — see applyDeathPenalty's comment) and only ever
    // targeted at this exact client, never broadcast, so there's no
    // targetId to check here the way 'sunk' needs one.
    this.room.onMessage('death_penalty', ({ lostGold, lostProducts, lostSailors }) => {
      this.onDeathPenalty?.(lostGold, lostProducts, lostSailors)
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
   * One shot is now `count` separate balls (one per real cannon on the
   * deck, see broadsideCannons in WorldRoom.js), fanned evenly across
   * CANNON_SPREAD_HALF_ANGLE around the free-aimed angle exactly like the
   * server just did — this only needs the aggregate range/speed the server
   * sends, not each individual cannon's exact numbers, since the actual
   * hit/miss and damage are already fully decided server-side by the time
   * this plays.
   */
  spawnBroadsideVolley(attackerId, angle, count, range, speed) {
    const attacker = this.room.state.players.get(attackerId)
    if (!attacker) return

    const baseAngle = angle

    // A fresh volley firing before the previous one's balls have all
    // resolved (fast reload) doesn't cut those short — they're still
    // legitimately in flight — just stop tracking them under this attacker
    // so this volley's own list isn't polluted with stale entries.
    this.activeCannonballs.set(attackerId, [])
    const list = this.activeCannonballs.get(attackerId)

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

  /** Stops whichever of this attacker's in-flight balls is currently closest to (x, y) — the one 'hit'/'cannonball_blocked' just said resolved there. Leaves every other ball in the volley flying. */
  stopNearestCannonball(attackerId, x, y) {
    const list = this.activeCannonballs.get(attackerId)
    if (!list) return
    let closest = null
    let closestDist = Infinity
    for (const ball of list) {
      const dist = Math.hypot(ball.x - x, ball.y - y)
      if (dist < closestDist) {
        closestDist = dist
        closest = ball
      }
    }
    if (!closest) return
    this.tweens.killTweensOf(closest)
    closest.destroy()
    list.splice(list.indexOf(closest), 1)
  }

  /**
   * Floating "-NN" over a ship that just got hit — a spark plus a number
   * that rises and fades, same tween shape as the '+amount золота' bounty
   * toast a bit further up, just angrier-colored and a size bigger so it
   * still reads clearly mid-fight with cannonballs and other ships around.
   * The spark reads as an impact, so it's specific to an actual hit — see
   * spawnFloatingText for the bare rise-and-fade text a dodge reuses
   * without it (nothing actually struck the hull).
   */
  spawnDamageNumber(x, y, damage) {
    const spark = this.add.image(x - 16, y - 34, 'damage-spark').setDepth(20)
    this.tweens.add({ targets: spark, y: '-=34', alpha: 0, duration: 900, onComplete: () => spark.destroy() })
    this.spawnFloatingText(x, y, `−${damage}`, '#ff9d94')
  }

  /** Bare rising/fading text over a world point — shared tween shape behind spawnDamageNumber and the 'dodged' handler's "Уворот" (see resolveHit in WorldRoom.js). */
  spawnFloatingText(x, y, text, color) {
    const toast = this.add
      .text(x - 2, y - 34, text, { fontSize: '20px', fontStyle: 'bold', color, stroke: '#2c1210', strokeThickness: 3 })
      .setOrigin(0, 0.5)
      .setDepth(20)
    this.tweens.add({ targets: toast, y: '-=34', alpha: 0, duration: 900, onComplete: () => toast.destroy() })
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
        const speed = this.mySpeed * this.hpSpeedMult()
        this.ship.setVelocity((vx / len) * speed, (vy / len) * speed)
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
    this.updateCargoBar(this.myCargoBar, this.ship.x, this.ship.y, this.cargoWeight, this.cargoCapacity)

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
    // frame is scrollFactor(0) but still rendered THROUGH the main camera,
    // which now (see applyCameraZoom) can be zoomed out — and Phaser zooms
    // a camera around its VIEWPORT CENTER, not its top-left corner, so a
    // shape drawn at its real screen coordinates would end up dragged
    // toward screen-center and shrunk. zoomCompensatePoint below picks the
    // coordinates that land back at the real ones once that zoom applies;
    // sizes/radii/line width scale by the same 1/zoom for the same reason.
    const zoom = this.cameras.main.zoom
    const p = this.zoomCompensatePoint(x - 2, y - 2)
    const compSize = (size + 4) / zoom
    frame.fillStyle(0x0b1a1f, 0.85)
    frame.fillRoundedRect(p.x, p.y, compSize, compSize, 12 / zoom)
    frame.lineStyle(2 / zoom, 0xd9a441, 0.55)
    frame.strokeRoundedRect(p.x, p.y, compSize, compSize, 12 / zoom)
  }

  /**
   * Where a "should look fixed on screen" point (desiredX, desiredY) needs
   * to actually be drawn so that, after the main camera's own zoom (which
   * scales everything it renders around the camera's CENTER, not its
   * top-left corner — including scrollFactor(0) objects, a common Phaser
   * surprise), it lands back at that exact screen position. Only needed
   * for scrollFactor(0) HUD that isn't already sitting dead-center —
   * coordText and the minimap frame, specifically.
   */
  zoomCompensatePoint(desiredX, desiredY) {
    const zoom = this.cameras.main.zoom
    const cx = this.scale.width / 2
    const cy = this.scale.height / 2
    return { x: cx + (desiredX - cx) / zoom, y: cy + (desiredY - cy) / zoom }
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
      this.coordText, this.myNameText, this.myNameCard, this.myHpBar.bg, this.myHpBar.fill,
      this.myCargoBar.bg, this.myCargoBar.fill,
      ...this.portSafeZoneRings,
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
    this.applyCameraZoom()
    this.repositionMinimap()
  }

  /**
   * See CAMERA_ZOOM_REFERENCE/CAMERA_ZOOM_MIN's own comment — smaller of
   * width/height so a landscape phone (wide but short) gets the same
   * treatment as portrait (narrow but tall) instead of only being judged
   * on whichever dimension happens to look "big enough." Re-run on every
   * resize (rotation, a desktop window being dragged narrower), not just
   * once at create — the minimap already re-lays itself out the same way
   * (see repositionMinimap, called right after this).
   */
  applyCameraZoom() {
    const zoom = Phaser.Math.Clamp(Math.min(this.scale.width, this.scale.height) / CAMERA_ZOOM_REFERENCE, CAMERA_ZOOM_MIN, 1)
    this.cameras.main.setZoom(zoom)
    // coordText is scrollFactor(0) but still rendered THROUGH the main
    // camera, so it needs the same zoomCompensatePoint treatment as
    // drawMinimapFrame (see that method's own comment for why a plain
    // .setScale alone — what this used to do — only happens to work for
    // something sitting dead-center, and visibly drags anything else, like
    // this, toward the middle of the screen instead of staying put).
    if (this.coordText) {
      const p = this.zoomCompensatePoint(COORD_TEXT_X, COORD_TEXT_Y)
      this.coordText.setPosition(p.x, p.y)
      this.coordText.setScale(1 / zoom)
    }
  }

  // Guarded by our own predicted cooldown (lastBroadsideFiredAt, set up in
  // create()) before sending anything — without this, mashing fire mid-reload
  // still sent 'fire' (which the server just silently drops) AND still called
  // onFireBroadside, which reset the HUD ring's animation to "just fired"
  // even though nothing actually did. The ring restarting with no shot to
  // show for it was the desync.
  fireFree(angle) {
    const now = Date.now()
    if (now - this.lastBroadsideFiredAt < FIRE_COOLDOWN_MS) return
    this.lastBroadsideFiredAt = now
    this.room.send('fire', { angle })
    this.onFireBroadside?.()
  }

  /**
   * Gamepad 'fire' button only (see the 'fire' onPress handler) — a
   * discrete press, so it fires toward whatever the right stick currently
   * points at, or straight ahead if it's centered (pressing fire without
   * bothering to aim should still do something reasonable, not nothing).
   * Touch never reaches this — the on-screen aim stick fires on release
   * instead, same gesture as the mouse (see updateAiming). Blocked in port
   * territory same as every other fire path.
   */
  fireFreeAimButton() {
    if (this.currentNearPortId !== null) {
      this.onActionRejected?.('Нельзя стрелять на территории порта')
      return
    }
    const stick = controls.getGamepadAimVector()
    const angle = Math.hypot(stick.x, stick.y) > STICK_AIM_DEADZONE
      ? Math.atan2(stick.y, stick.x)
      : this.ship.rotation - Math.PI / 2 // ship's own forward direction — see the rotation convention note server-side (approachStep)
    this.fireFree(angle)
  }

  /**
   * Free-aim polling, run every frame from update(). Two trigger shapes
   * share one preview cone:
   *  - "Held" sources — mouse and the on-screen aim stick — fire on
   *    release, the same real-trigger gesture either way: hold to preview,
   *    let go to shoot (direct feedback: a discrete Действие-press-while-
   *    aiming, tried first, didn't read as the same gesture as the mouse
   *    and nothing fired on releasing the stick — this replaces that).
   *  - Gamepad's right stick is continuous preview only, no release-fire —
   *    it has its own dedicated button instead (see fireFreeAimButton),
   *    since a player holding a steady aim on a gamepad generally wants to
   *    fire more than once without letting go of the stick, unlike a
   *    thumb leaving an on-screen stick or a mouse button coming up.
   *
   * Firing is blocked in port territory (see isNearAnyPort in WorldRoom.js)
   * — this.currentNearPortId (set by checkNearPort, run just before this
   * every frame) is this client's own copy of that same check. While
   * docked, no source draws a cone (there'd be nothing honest to show — the
   * server will refuse the shot regardless of where it's aimed), and
   * releasing a held source shows a toast instead of actually firing, so
   * mashing it in port never sends a single 'fire' the server would've had
   * to silently drop, and the reload ring never fakes a shot that didn't
   * happen (see fireFree's own note on that exact desync).
   */
  updateAiming() {
    const inPort = this.currentNearPortId !== null
    // wasTouch guard: Phaser reports an active touch through the exact same
    // "left button down" state a real mouse click does — without it,
    // dragging the on-screen joystick (or just resting a second finger
    // anywhere on the canvas) read as a held mouse button and fired on
    // release. Touch has its own dedicated aim source (the stick) below.
    const mouseHeld = !this.input.activePointer.wasTouch && this.input.activePointer.leftButtonDown()
    const touchStick = controls.getTouchAimVector()
    const touchHeld = Math.hypot(touchStick.x, touchStick.y) > STICK_AIM_DEADZONE
    const gamepadStick = controls.getGamepadAimVector()
    const gamepadActive = Math.hypot(gamepadStick.x, gamepadStick.y) > STICK_AIM_DEADZONE

    let angle = null
    if (mouseHeld) angle = Math.atan2(this.input.activePointer.worldY - this.ship.y, this.input.activePointer.worldX - this.ship.x)
    else if (touchHeld) angle = Math.atan2(touchStick.y, touchStick.x)
    else if (gamepadActive) angle = Math.atan2(gamepadStick.y, gamepadStick.x)

    if (angle !== null && !inPort) {
      this.currentAimAngle = angle
      this.drawAimCone(angle)
    } else {
      this.aimCone.clear()
    }

    const releasableHeld = mouseHeld || touchHeld
    if (!releasableHeld && this.wasReleasableHeld) {
      if (inPort) this.onActionRejected?.('Нельзя стрелять на территории порта')
      else this.fireFree(this.currentAimAngle)
    }
    this.wasReleasableHeld = releasableHeld
  }

  /**
   * Called from WorldPage.vue's activePortId watch — true while PortModal
   * is open. Resets wasReleasableHeld on lock so a mouse/touch press that
   * was mid-hold the instant the modal opened doesn't read as a "release"
   * (and fire) the moment it's unlocked again; movement/aiming/firing
   * themselves are skipped in update() while this is true (see the
   * inputLocked check there), this just handles the immediate visual
   * cleanup.
   */
  setInputLocked(locked) {
    this.inputLocked = locked
    if (!locked) return
    this.ship.setVelocity(0, 0)
    this.aimCone.clear()
    this.wasReleasableHeld = false
  }

  /**
   * Redraws the aim preview for the current frame — cleared and redrawn
   * every frame it's active since the ship (its origin) keeps moving.
   * Shows exactly what's about to fire: a thin ray per real cannon on the
   * WHOLE deck (this ship's real gun count — see SHIP_CANNON_COUNT), fanned
   * across the same CANNON_SPREAD_HALF_ANGLE the server actually fires
   * with, each as long as the last known real range (see lastKnownRange),
   * plus a faint wash across the whole spread so the covered zone still
   * reads at a glance even with a lot of thin rays.
   */
  drawAimCone(baseAngle) {
    const range = this.lastKnownRange
    const shipType = this.meRef?.shipType ?? 'boat'
    const count = SHIP_CANNON_COUNT[shipType] ?? SHIP_CANNON_COUNT.boat

    const cone = this.aimCone
    cone.clear()

    // Wash across the full theoretical spread — a general "this direction,
    // this max reach" backdrop behind the individual rays below, which are
    // what actually shows how far each gun can currently reach.
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
    // fire, same even spacing as spawnBroadsideVolley/handleFire use. Each
    // one stops independently at whatever it'd actually reach first — an
    // island, another ship, or a port's safe zone (see
    // rayObstructionDistance) — instead of always drawing at full range
    // regardless of what's actually in the way.
    cone.lineStyle(1.5, 0xf0c96b, 0.75)
    cone.beginPath()
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5 // -0.5..0.5
      const angle = baseAngle + t * 2 * CANNON_SPREAD_HALF_ANGLE
      const rayLen = this.rayObstructionDistance(this.ship.x, this.ship.y, angle, range)
      cone.moveTo(this.ship.x, this.ship.y)
      cone.lineTo(this.ship.x + Math.cos(angle) * rayLen, this.ship.y + Math.sin(angle) * rayLen)
    }
    cone.strokePath()
  }

  /**
   * How far along a ray from (originX, originY) at `angle` before it hits
   * whatever the aim preview should stop at, capped at maxRange — an
   * island, another ship, or a port's safe zone (ports/ships aren't
   * physically solid to a real cannonball, see tickCannonballs, but
   * drawing the preview stopping there reads as "no point shooting past
   * this" instead of implying a longer reach than actually matters).
   */
  rayObstructionDistance(originX, originY, angle, maxRange) {
    const dx = Math.cos(angle)
    const dy = Math.sin(angle)
    let dist = maxRange

    for (const sprite of this.otherShips.values()) {
      const hit = rayCircleHit(originX, originY, dx, dy, sprite.x, sprite.y, AIM_RAY_SHIP_RADIUS)
      if (hit !== null && hit < dist) dist = hit
    }

    for (const port of this.ports) {
      const hit = rayCircleHit(originX, originY, dx, dy, port.x, port.y, PORT_ENTER_RANGE)
      if (hit !== null && hit < dist) dist = hit
    }

    // Islands are irregular, not circles — no clean analytic shortcut, so
    // this marches in short steps and stops at the first blocked sample
    // instead (same idea WorldRoom.js's own pathClear uses server-side).
    const steps = Math.ceil(dist / AIM_RAY_STEP)
    for (let i = 1; i <= steps; i++) {
      const d = Math.min(dist, i * AIM_RAY_STEP)
      if (this.collidesWithIsland(originX + dx * d, originY + dy * d)) return d
    }

    return dist
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

  /**
   * Fraction of full speed available right now, straight off live HP — see
   * HP_SPEED_DEBUFF_FLOOR's own comment for the floor/reasoning. Read fresh
   * every frame movement is applied (this.meRef.hp already updates every
   * tick via the schema, same source updateHpBar reads for the HP bar
   * itself), not cached anywhere — speed should visibly recover the
   * instant a repair at the Мастерская lands, same tick the HP bar does.
   */
  hpSpeedMult() {
    const hp = this.meRef?.hp ?? this.myMaxHp
    const fraction = this.myMaxHp > 0 ? Phaser.Math.Clamp(hp / this.myMaxHp, 0, 1) : 1
    return HP_SPEED_DEBUFF_FLOOR + (1 - HP_SPEED_DEBUFF_FLOOR) * fraction
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

  /** Same left-anchored bg+fill pill as createHpBar, own ship only — see CARGO_BAR_Y_OFFSET's own comment for why nobody else's is ever drawn. */
  createCargoBar(x, y) {
    const bg = this.add.image(x, y, 'cargo-bar-bg').setOrigin(0, 0.5).setDepth(10)
    const fill = this.add.image(x, y, 'cargo-bar-fill').setOrigin(0, 0.5).setDepth(11)
    fill.setCrop(0, 0, HP_BAR_WIDTH, CARGO_BAR_HEIGHT)
    return { bg, fill }
  }

  updateCargoBar(bar, shipX, shipY, weight, capacity) {
    const barX = shipX - HP_BAR_WIDTH / 2
    const barY = shipY + CARGO_BAR_Y_OFFSET
    bar.bg.setPosition(barX, barY)
    bar.fill.setPosition(barX, barY)
    const fraction = capacity > 0 ? Phaser.Math.Clamp(weight / capacity, 0, 1) : 0
    bar.fill.setCrop(0, 0, HP_BAR_WIDTH * fraction, CARGO_BAR_HEIGHT)
  }

  /**
   * Absolute set — called from WorldPage.vue's refreshShipStats() after a
   * fresh api.getShip() (on world load, and whenever PortModal closes,
   * since trading/buying a bigger hull/etc. all happen over plain Laravel
   * calls the room never sees, same reasoning as refresh_ship). Cargo
   * weight was never added to the Player schema itself — unlike hp, it's
   * pure display, nothing server-authoritative here ever reads it, so a
   * lazily-synced client-side number is enough; it didn't earn a permanent
   * spot in every player's replicated state just for this bar.
   */
  setCargo(weight, capacity) {
    this.cargoWeight = weight
    this.cargoCapacity = capacity
    this.cargoReady = true
  }

  /**
   * Called from refreshShipStats() with `speed` straight off
   * ShipController::serialize — already the real, Паруса-boosted
   * multiplier (see Ship::effectiveStat server-side), same scale as this
   * client's own SHIP_SPEED_MULT table (a stock hull with no rigging
   * returns exactly that table's value). speedMult isn't part of the
   * Player schema (see setCargo's own comment for the identical reasoning
   * — Оснастка levels are plain Laravel state, not something the realtime
   * room tracks for movement, which stays entirely client-authoritative).
   * setMaxVelocity is required alongside recomputing mySpeed — see the
   * schema onChange handler's own comment on why the Arcade body's cap
   * doesn't move on its own.
   */
  setSpeedMult(effectiveSpeed) {
    this.speedMult = effectiveSpeed
    this.mySpeed = SHIP_SPEED * this.speedMult
    this.ship?.setMaxVelocity(this.mySpeed)
  }

  /**
   * Cheap incremental bump for a cargo-drop pickup (see onCargoClaimed) —
   * the exact claimed amount is already known client-side, no need to
   * round-trip a fresh api.getShip() just to add it in. Gated on cargoReady:
   * a pickup can land before refreshShipStats()'s first setCargo() call
   * resolves, and bumping cargoWeight against the still-default capacity=1
   * from create() briefly rendered the bar as full/overflowing. The DB
   * write behind this pickup happens before 'cargo_claimed' is even sent
   * (see WorldRoom), so the in-flight api.getShip() picks it up on its own
   * once it resolves — dropping the delta here doesn't lose it.
   */
  addCargoWeight(delta) {
    if (!this.cargoReady) return
    this.cargoWeight = Math.max(0, this.cargoWeight + delta)
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
  let weightDelta = 0
  // WorldRoom's claimCargoDropAsync already persisted this to the DB
  // (awardBounty) — coins.value is a local display cache (see refreshShipStats)
  // that nothing else keeps in sync with a pickup, so without this the
  // inventory overlay showed a stale gold count until the next port visit.
  if (gold > 0) coins.value += gold
  if (gold > 0) parts.push(`${gold} золота`)
  for (const [type, qty] of Object.entries(products || {})) {
    if (qty > 0) {
      parts.push(`${PRODUCT_NAMES[type] ?? type} ×${qty}`)
      weightDelta += qty * (PRODUCT_WEIGHTS[type] ?? 0)
    }
  }
  if (weightDelta > 0) game?.scene.getScene('world')?.addCargoWeight(weightDelta)
  if (parts.length === 0) return
  Notify.create({ type: 'positive', message: `Вы подобрали груз: ${parts.join(', ')}`, position: 'top' })
}

// Cargo weight/capacity AND the Оснастка-boosted speed multiplier aren't
// in the Player schema (see setCargo/setSpeedMult's own comments in
// WorldScene) — fetched here whenever either could have changed: once on
// world load, again whenever PortModal closes (the activePortId watch
// below, a backstop for anything that somehow didn't emit 'ship-changed'),
// and — this is the one that actually matters for feeling a Паруса upgrade
// land — every single 'ship-changed' itself (see onShipChanged), not just
// on close. It used to be close-only: input is locked the whole time
// PortModal is open anyway, so a player could never actually FEEL a fresh
// speed boost until after closing, but the real bug was upgrading
// Паруса, closing, and still seeing no difference — repair/buyShip/
// upgradeCannon all already refresh over 'ship-changed' immediately, cargo
// and speed were the two things quietly waiting for the close-time
// backstop instead of getting the same immediate treatment (direct
// feedback: "проверь оно вообще применяется? я разницы не вижу").
async function refreshShipStats() {
  try {
    const { ship } = await api.getShip()
    game?.scene.getScene('world')?.setCargo(ship.cargo_weight, ship.capacity)
    game?.scene.getScene('world')?.setSpeedMult(ship.speed)
  } catch {
    // Best-effort cosmetic sync — a failed fetch just leaves the bar at its last known fraction.
  }
}

// PortModal's 'ship-changed' — fired the instant repair/buyShip/
// upgradeCannon/upgradeRigging's own response actually lands (see that
// component), not just on close. room.send('refresh_ship') covers what the
// realtime room itself tracks (hp/shipType/cannon levels); refreshShipStats
// covers what it doesn't (cargo, and now the Паруса speed multiplier —
// see that function's own comment for why this used to only happen later).
function onShipChanged() {
  room.send('refresh_ship')
  refreshShipStats()
}

// Was a Phaser text tween floating over the ship — sat right where the
// ship's own name plate + HP bar are drawn (see createNameCard/updateHpBar
// in WorldScene, both depth 9-11), so at the default depth it got hidden
// behind them. A real Quasar notification lives in its own DOM layer above
// the canvas entirely, so it can never be covered by anything drawn in it.
function notifyActionRejected(message) {
  Notify.create({ type: 'negative', message, position: 'top' })
}

// Just stashes the raw numbers — DeathPenaltyModal itself turns
// lostProducts into labeled rows (see its own PRODUCT_NAMES).
function notifyDeathPenalty(lostGold, lostProducts, lostSailors) {
  deathSummary.value = { lostGold, lostProducts, lostSailors }
}

// Same destination as the gamepad/keyboard 'back' action (see onBackPress
// in the scene data below) and what the app header's own arrow used to do
// before MainLayout.vue stopped rendering it on this route — this button
// is what replaces that for anyone without a bound controller.
function leaveWorld() {
  router.push('/')
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

  // The router guard (see router/index.js) already keeps a request with NO
  // token at all from ever reaching this page — this is the other half:
  // one that's present but the server rejects anyway (expired, revoked,
  // stale from a wiped test account). Used to just fail Promise.all with
  // nothing catching it, leaving an empty canvas behind all the HUD chrome
  // (still rendered — it doesn't depend on this succeeding) with no
  // explanation and no way out short of a manual reload.
  let ports
  try {
    ;[, { ports }] = await Promise.all([
      joinWorld().then((r) => (room = r)),
      api.listPorts(),
    ])
  } catch {
    setToken(null)
    router.replace('/login')
    return
  }

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
    onDeathPenalty: notifyDeathPenalty,
    onAbordageStarted: (abordageId) => { router.push(`/abordage/${abordageId}`) },
    onActionPress: performAction,
    onInventoryPress: toggleInfo,
    onBackPress: () => router.push('/'),
    onFireBroadside: noteBroadsideFired,
  })
  refreshShipStats()
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
// PortModal's own 'ship-changed' (below) is what actually fires this right
// after each action — this close-time refresh is just a harmless backstop
// for anything that changed but somehow didn't emit it.
watch(activePortId, (id, prevId) => {
  game?.scene.getScene('world')?.setInputLocked(!!id)
  if (!id && prevId) {
    room.send('refresh_ship')
    refreshShipStats()
  }
})

onBeforeUnmount(() => {
  stopGamepadWatch?.()
  room?.leave()
  game?.destroy(true)
  if (cooldownRaf) cancelAnimationFrame(cooldownRaf)
})
</script>

<style scoped>
/* Matches COORD_TEXT_Y's own comment in the script — this sits at the
   very top-left corner, and the coordinate readout right below it is
   pushed down far enough to clear it. Light chip + dark icon (same
   readable-over-anything pairing coordText itself now uses) rather than
   a plain dark icon, which would vanish against open water the same way
   the old pale coordinates vanished against sand. */
.world-exit-btn {
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: calc(12px + env(safe-area-inset-left, 0px));
  z-index: 15;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(240, 234, 214, 0.88);
  border: 1px solid rgba(26, 20, 16, 0.3);
  color: #1a1410;
  cursor: pointer;
  padding: 0;
}
.world-exit-btn svg { width: 18px; height: 18px; }

.context-prompt {
  position: absolute;
  /* Below the exit button + coordinates row now (see .world-exit-btn,
     ~12px top + 34px tall), not level with it — same top offset used to
     put both at roughly the same height, which on a narrow phone could
     run this banner's centered pill right into that corner. */
  top: calc(58px + env(safe-area-inset-top, 0px));
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

/* Reload readout — desktop/gamepad only (a phone folds the same progress
   into .touch-btn's own background instead, see the touch-controls block
   below). Non-interactive now that free aim's fire input doesn't live at a
   fixed screen position anymore — a plain gauge, not a button. Кольцо
   красит сам conic-gradient в inline style (см. broadsideRingStyle), тут
   только форма и подложка под иконку. */
.broadside-hud {
  position: absolute;
  right: calc(16px + env(safe-area-inset-right, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  z-index: 15;
}
.broadside-ring {
  width: 60px;
  height: 60px;
  border-radius: 50%;
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
 * none) — only the sticks and the buttons themselves re-enable it. Without
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
/* Mirrors the movement stick's corner, opposite side — see the aim-stick
   sketch (right stick bottom-right, movement stick bottom-left). */
.touch-controls__aim-stick {
  position: absolute;
  right: calc(20px + env(safe-area-inset-right, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  pointer-events: auto;
}
.touch-btn {
  pointer-events: auto;
  position: absolute;
  /* Sits just left of the aim stick, same bottom row — direct sketch. */
  right: calc(20px + 116px + 12px + env(safe-area-inset-right, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
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
/* Same top-left row as .world-exit-btn + the coordinate readout, right
   after the coords (COORD_TEXT_X=56 plus room for its widest realistic
   string, "X: 4800 Y: 4800" at MAP_SIZE) — not the top-right corner
   opposite the exit button like the original sketch (two rounds of direct
   feedback: it landed exactly on top of the minimap in portrait — same
   corner, same 12px margin — and moving it down by the minimap's
   worst-case size instead put it in the aim stick's way in landscape,
   where the shorter viewport meant that same pixel offset landed near the
   BOTTOM). The minimap and the aim stick both live on the right side in
   every orientation; the top-left row next to the exit button is the one
   spot that's never contested by either. */
.touch-inventory-btn {
  pointer-events: auto;
  position: absolute;
  top: calc(12px + env(safe-area-inset-top, 0px));
  left: calc(200px + env(safe-area-inset-left, 0px));
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(240, 234, 214, 0.88);
  border: 1px solid rgba(26, 20, 16, 0.3);
  color: #1a1410;
  padding: 0;
}
.touch-inventory-btn svg { width: 17px; height: 17px; }

/*
 * .world-page used to leave its height to Quasar's QPage component, which
 * measures the real header height in JS and sizes the page to fit below it
 * (min-height: calc(...) as an inline style). That made sense while World
 * had a header to fit under — it no longer does (MainLayout hides the
 * header entirely on this route), and that JS-measured, header-relative
 * calc turned out to be exactly what broke on iOS after an orientation
 * change (reported as the whole page rendering oversized/blurry after
 * rotate+reload). position:fixed + 100dvh sidesteps Quasar's measurement
 * entirely and tracks the actual visible viewport natively — 100dvh in
 * particular (vs plain 100vh) is what correctly follows the address bar
 * showing/hiding across an orientation change on iOS Safari/Chrome-iOS.
 * !important beats QPage's own inline min-height, which Vue still applies
 * since the component itself is still in use for its other page behavior.
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
  position: fixed !important;
  inset: 0;
  height: 100dvh !important;
  min-height: 0 !important;
}
.world-frame {
  position: absolute;
  inset: 0;
}
.world-canvas { width: 100%; height: 100%; }
</style>
