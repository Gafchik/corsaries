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
      <div v-if="contextPrompt" class="context-prompt" @click="performAction">
        <span class="context-prompt__text">{{ contextPrompt.text }}</span>
        <span class="context-prompt__hint">Действие</span>
      </div>

      <!-- Touch-only: a phone with no gamepad paired (see showTouchControls)
           gets an on-screen stick + fire/action buttons instead of relying on
           WASD/gamepad. Sits above the canvas, so a tap here never also
           reaches the canvas's own pointerdown-fires-cannon handler below. -->
      <div v-if="showTouchControls" class="touch-controls">
        <TouchJoystick class="touch-controls__stick" />
        <div class="touch-controls__buttons">
          <button class="touch-btn touch-btn--fire" @pointerdown.prevent="controls.touchPress('fireRight')">Правый борт</button>
          <div class="touch-controls__row">
            <button class="touch-btn touch-btn--fire" @pointerdown.prevent="controls.touchPress('fireLeft')">Левый борт</button>
            <button class="touch-btn touch-btn--action" @pointerdown.prevent="controls.touchPress('action')">Действие</button>
          </div>
        </div>
      </div>

      <ShipInfoOverlay v-if="showInfo" :ship-info="shipInfo" :coins="coins" @close="showInfo = false" />
    </div>
  </q-page>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import Phaser from 'phaser'
import { getStateCallbacks } from 'colyseus.js'
import { joinWorld } from '@/services/realtime'
import { api } from '@/services/api'
import { controls, isPhone, onGamepadChange } from '@/services/controls'
import ShipInfoOverlay from '@/components/ShipInfoOverlay.vue'
import TouchJoystick from '@/components/TouchJoystick.vue'

const router = useRouter()
const container = ref(null)
const nearPort = ref(null)
const nearBot = ref(null)
const nearHuman = ref(null)
const showInfo = ref(false)
const shipInfo = ref(null)
const coins = ref(0)
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

// Keep in sync with CANNON_RANGE in realtime/src/rooms/WorldRoom.js — the
// hit was already decided there the instant 'fire' arrived (no lag
// compensation for a traveling shot in a networked game); this is purely
// the visual of a ball crossing that same distance, closer in spirit to the
// original's Cannonball._range than to the actual hit resolution.
const CANNON_RANGE = 260
const CANNONBALL_SPEED = 600 // px/s

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
const HP_BAR_WIDTH = 36
const HP_BAR_HEIGHT = 4
// Between the ship and its name label (name sits at -28) — reads as
// "belongs to this ship" without overlapping either.
const HP_BAR_Y_OFFSET = -21

function shipLabel(name, shipType) {
  return `${name} (${SHIP_TYPE_NAMES[shipType] ?? shipType})`
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
    this.onLootAvailable = data.onLootAvailable
    this.onAbordageStarted = data.onAbordageStarted
    this.onActionPress = data.onActionPress
    this.onInventoryPress = data.onInventoryPress
    this.onBackPress = data.onBackPress
    this.currentNearPortId = null
    this.currentNearBotId = null
    this.currentNearHumanId = null
  }

  preload() {
    // Kenney's Pirate Pack (CC0) — top-down, bow pointing up, so it drops
    // straight into the existing rotation convention with no math changes.
    // One sprite per hull type (config/ships.php order) — every ship on
    // screen now actually looks like what it is, boats included.
    for (const type of SHIP_TYPES) this.load.image(`ship-${type}`, `ships/ship-${type}.png`)
    this.load.image('vegetation', 'islands/vegetation.png')
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

    for (const port of this.ports) {
      // An emoji glyph instead of a hand-drawn circle — the browser's own
      // color font renders it, so it reads as a real building/harbor icon
      // with zero extra assets to source.
      const marker = this.add.text(port.x, port.y, '🏛️', { fontSize: '34px' }).setOrigin(0.5)
      marker.setDepth(2)
      this.add.text(port.x, port.y + 22, port.name, { fontSize: '12px', color: '#ffffff', stroke: '#0a1f28', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(2)

      // The real marker is only 36 world-units across — invisible at
      // minimap zoom. Same exaggerated-dot trick as the player marker,
      // main-camera-only-ignored so it doesn't show twice in the world.
      const miniDot = this.add.circle(port.x, port.y, 130, 0xff6666).setStrokeStyle(30, 0x3a0f0f, 1).setDepth(999)
      this.cameras.main.ignore(miniDot)
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
      gfx.fillStyle(0xe0c98a, 1)
      gfx.beginPath()
      const n = island.points.length
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2
        const r = island.points[i]
        const px = island.x + Math.cos(angle) * r
        const py = island.y + Math.sin(angle) * r
        if (i === 0) gfx.moveTo(px, py)
        else gfx.lineTo(px, py)
      }
      gfx.closePath()
      gfx.fillPath()
      gfx.setDepth(0)

      const clumps = Math.max(2, Math.round(island.baseRadius / 25))
      for (let i = 0; i < clumps; i++) {
        const angle = Math.random() * Math.PI * 2
        const dist = Math.random() * island.baseRadius * 0.55
        const leaf = this.add.sprite(island.x + Math.cos(angle) * dist, island.y + Math.sin(angle) * dist, 'vegetation')
        leaf.setScale(0.6 + Math.random() * 0.5)
        leaf.setRotation(Math.random() * Math.PI * 2)
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
    this.activeCannonballs = new Map() // attackerId -> in-flight ball sprite

    this.setupNetworking()

    // Mouse buttons fire broadsides too — right hand naturally rests on the
    // mouse while WASD (left hand) handles movement. This stays a fixed,
    // non-rebindable convenience on top of the controls module below, not a
    // replacement for it — everything here must also work with the mouse
    // untouched (keyboard alone, or a gamepad). 'left'/'right' below are
    // just the server's internal labels for the two broadside vectors —
    // when the bow faces up-screen, the vector labeled 'right' actually
    // points screen-left (verified against the working hit-detection math,
    // not guessed), so the screen-left broadside (mouse left button) sends
    // 'right' and the screen-right one (mouse right button) sends 'left'.
    this.input.mouse?.disableContextMenu()
    this.input.on('pointerdown', (pointer) => {
      if (pointer.leftButtonDown()) this.room.send('fire', { side: 'right' })
      else if (pointer.rightButtonDown()) this.room.send('fire', { side: 'left' })
    })

    // Rebindable keyboard/gamepad actions (see services/controls.js) — the
    // same fireLeft/fireRight/action/inventory actions work from either
    // device, whatever the player has bound them to.
    this.controlUnsubs = [
      controls.onPress('fireLeft', () => this.room.send('fire', { side: 'right' })),
      controls.onPress('fireRight', () => this.room.send('fire', { side: 'left' })),
      controls.onPress('action', () => this.onActionPress?.()),
      controls.onPress('inventory', () => this.onInventoryPress?.()),
      // Circle/B on a gamepad, Escape on keyboard — same universal "back"
      // convention as every other screen (Port, Abordage, Loot, Controls),
      // just meaning "leave the world" here instead of "close this dialog".
      controls.onPress('back', () => this.onBackPress?.()),
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
      this.minimapCam.ignore(sprite.nameText)
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
      sprite?.hpBar.bg.destroy()
      sprite?.hpBar.fill.destroy()
      sprite?.destroy()
      this.otherShips.delete(sessionId)
    })

    this.room.onMessage('fired', ({ attackerId, side }) => this.spawnCannonball(attackerId, side))

    this.room.onMessage('hit', ({ attackerId, targetId, hp }) => {
      this.stopCannonball(attackerId) // found its mark — don't let the visual keep flying past it
      if (targetId === mySessionId) {
        this.hpText.setText(`HP: ${hp}/${this.myMaxHp}`)
        this.cameras.main.flash(150, 200, 40, 40)
      } else {
        // A brief full-color flash reads clearly as "just got hit" since
        // the hull carries no tint of its own otherwise (hostility is
        // shown by the name label's color only — see nameColor above).
        const targetSprite = this.otherShips.get(targetId)
        targetSprite?.setTintFill(0xff6666)
        this.time.delayedCall(150, () => targetSprite?.active && targetSprite.clearTint())
      }
    })

    // The server now actually stops a ball at the shoreline (see
    // tickCannonballs in WorldRoom.js) instead of letting shots pass through
    // islands — without this the client's blind visual tween would keep
    // flying straight through the land it just got blocked by.
    this.room.onMessage('cannonball_blocked', ({ attackerId }) => this.stopCannonball(attackerId))

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

    this.room.onMessage('bounty', ({ attackerId, amount }) => {
      if (attackerId !== mySessionId) return
      const toast = this.add.text(this.ship.x, this.ship.y - 40, `+${amount} золота`, { fontSize: '14px', color: '#ffe08a' }).setOrigin(0.5)
      this.tweens.add({ targets: toast, y: toast.y - 30, alpha: 0, duration: 1200, onComplete: () => toast.destroy() })
    })

    this.room.onMessage('loot_available', ({ attackerId, offerId }) => {
      if (attackerId === mySessionId) this.onLootAvailable(offerId)
    })

    // Sent directly to both participants (not broadcast) — see
    // startPvpAbordage in WorldRoom.js. No accept/decline: both clients
    // just get redirected the instant Laravel confirms the fight exists.
    this.room.onMessage('abordage_started', ({ abordageId }) => this.onAbordageStarted(abordageId))
  }

  /**
   * A blind visual guess, started the instant 'fire' arrives for low-latency
   * feedback — the real resolution now happens server-side over the flight
   * (see tickCannonballs in WorldRoom.js), which is what actually decides
   * hit/miss/blocked and can arrive before this tween finishes. When it
   * does, 'hit' or 'cannonball_blocked' calls stopCannonball() to cut this
   * tween short instead of letting it visibly fly past what stopped it.
   */
  spawnCannonball(attackerId, side) {
    const attacker = this.room.state.players.get(attackerId)
    if (!attacker) return

    const fx = Math.sin(attacker.rotation)
    const fy = -Math.cos(attacker.rotation)
    const dir = side === 'right' ? { x: fy, y: -fx } : { x: -fy, y: fx }

    const key = `${attackerId}:${side}`
    this.activeCannonballs.get(key)?.destroy()

    const ball = this.add.sprite(attacker.x, attacker.y, 'cannonball')
    this.activeCannonballs.set(key, ball)
    this.tweens.add({
      targets: ball,
      x: attacker.x + dir.x * CANNON_RANGE,
      y: attacker.y + dir.y * CANNON_RANGE,
      duration: (CANNON_RANGE / CANNONBALL_SPEED) * 1000,
      onComplete: () => {
        ball.destroy()
        if (this.activeCannonballs.get(key) === ball) this.activeCannonballs.delete(key)
      },
    })
  }

  stopCannonball(attackerId) {
    for (const side of ['left', 'right']) {
      const key = `${attackerId}:${side}`
      const ball = this.activeCannonballs.get(key)
      if (!ball) continue
      this.tweens.killTweensOf(ball)
      ball.destroy()
      this.activeCannonballs.delete(key)
    }
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

    for (const sprite of this.otherShips.values()) {
      sprite.x += (sprite.targetX - sprite.x) * OTHER_SHIP_LERP
      sprite.y += (sprite.targetY - sprite.y) * OTHER_SHIP_LERP
      // Shortest-path angle interpolation — a plain lerp on raw radians spins
      // the wrong way whenever a turn crosses the 0/2π wraparound.
      const diff = Math.atan2(Math.sin(sprite.targetRotation - sprite.rotation), Math.cos(sprite.targetRotation - sprite.rotation))
      sprite.rotation += diff * OTHER_SHIP_LERP
      sprite.nameText.setPosition(sprite.x, sprite.y - 28)
      this.updateHpBar(sprite.hpBar, sprite.x, sprite.y, sprite.playerRef.hp, sprite.playerRef.maxHp)
    }

    this.coordText.setText(`X: ${Math.round(this.ship.x)}  Y: ${Math.round(this.ship.y)}`)
    this.minimapPlayerDot.setPosition(this.ship.x, this.ship.y)
    this.myNameText.setPosition(this.ship.x, this.ship.y - 28)
    this.updateHpBar(this.myHpBar, this.ship.x, this.ship.y, this.meRef?.hp ?? this.myMaxHp, this.myMaxHp)

    this.checkNearPort()
    this.checkNearBot()
    this.checkNearHuman()
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

  setupMinimap() {
    const { size, x, y } = this.minimapLayout()

    const frame = this.add.rectangle(x - 2, y - 2, size + 4, size + 4, 0x0a1f28, 0.85).setOrigin(0).setScrollFactor(0)
    frame.setStrokeStyle(2, 0xbcd9d1, 0.6)
    this.minimapFrame = frame

    this.minimapCam = this.cameras.add(x, y, size, size)
    this.minimapCam.setZoom(size / MAP_SIZE)
    this.minimapCam.setBounds(0, 0, MAP_SIZE, MAP_SIZE)
    this.minimapCam.setBackgroundColor('#0e3b4d')

    // A dedicated bright marker — the real ship sprite is only a few
    // world-units across and disappears at minimap zoom otherwise, and with
    // ~100 bots on the map now it'd be lost in the crowd anyway. A big
    // outlined dot on top of everything else is the only way to actually
    // spot yourself. Only meant for the minimap, so the main camera must
    // ignore it — otherwise it renders as a giant circle over the real ship.
    // Cyan — deliberately far from the orange/red bot and port palette so it
    // never gets mistaken for a hostile or a city marker at a glance.
    this.minimapPlayerDot = this.add.circle(this.ship.x, this.ship.y, 160, 0x4ce0ff).setStrokeStyle(40, 0x0a3540, 1).setDepth(1000)
    // Only meant for the minimap — the main camera must ignore it, or it
    // renders as a giant circle over the real ship. It must NOT also be in
    // minimapCam's ignore list below (that was the actual bug: it ended up
    // hidden from both cameras, same mistake the frame had earlier).
    this.cameras.main.ignore(this.minimapPlayerDot)

    // The frame is a screen-fixed HUD element for the main camera only — the
    // minimap camera must ignore it, or it'd draw as a giant rectangle over
    // the whole minimap.
    this.minimapCam.ignore([frame, this.hpText, this.coordText, this.myNameText, this.myHpBar.bg, this.myHpBar.fill])
  }

  /** Re-lays out the minimap after the canvas itself has resized (see handleResize) — otherwise it stays pinned to its create()-time corner and size while the rest of the HUD moves. */
  repositionMinimap() {
    if (!this.minimapCam) return
    const { size, x, y } = this.minimapLayout()
    this.minimapFrame.setPosition(x - 2, y - 2)
    this.minimapFrame.setSize(size + 4, size + 4)
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

  /**
   * A dark backing rect plus a colored fill rect, both left-anchored
   * (origin 0, 0.5) so the fill shrinks from the right as HP drops instead
   * of staying centered — the usual game-HUD HP-bar convention. Shared by
   * the player's own ship and every other ship (bots included) — same
   * visual, same math, just fed a different live HP source each frame (see
   * updateHpBar).
   */
  createHpBar(x, y) {
    const bg = this.add.rectangle(x, y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x0a1f28, 0.85).setOrigin(0, 0.5).setDepth(10)
    bg.setStrokeStyle(1, 0x000000, 0.4)
    const fill = this.add.rectangle(x, y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x6fd98a, 1).setOrigin(0, 0.5).setDepth(11)
    return { bg, fill }
  }

  updateHpBar(bar, shipX, shipY, hp, maxHp) {
    const barX = shipX - HP_BAR_WIDTH / 2
    const barY = shipY + HP_BAR_Y_OFFSET
    bar.bg.setPosition(barX, barY)
    bar.fill.setPosition(barX, barY)

    const fraction = maxHp > 0 ? Phaser.Math.Clamp(hp / maxHp, 0, 1) : 0
    bar.fill.setSize(HP_BAR_WIDTH * fraction, HP_BAR_HEIGHT)
    // Green/amber/red at a glance — matches the same thresholds as the
    // HP number itself would read at, no need to also read the digits to
    // tell "fine" from "about to sink" from across the map.
    bar.fill.setFillStyle(fraction > 0.5 ? 0x6fd98a : fraction > 0.25 ? 0xffd166 : 0xe05a5a, 1)
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

function enterPort() {
  if (nearPort.value) router.push(`/port/${nearPort.value.id}`)
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
function performAction() {
  if (nearHuman.value) challengeHuman()
  else if (nearBot.value) enterAbordage()
  else if (nearPort.value) enterPort()
}

// Same priority as performAction() above, by construction — this only
// decides what the notice SAYS, performAction alone decides what pressing
// Действие actually DOES, so the two can never disagree with each other.
const contextPrompt = computed(() => {
  if (nearHuman.value) return { text: `Абордаж — ${nearHuman.value.firstName} (игрок)` }
  if (nearBot.value) return { text: `Абордаж — ${nearBot.value.firstName}` }
  if (nearPort.value) return { text: `Войти в порт «${nearPort.value.name}»` }
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
    onLootAvailable: (offerId) => { router.push(`/loot/${offerId}`) },
    onAbordageStarted: (abordageId) => { router.push(`/abordage/${abordageId}`) },
    onActionPress: performAction,
    onInventoryPress: toggleInfo,
    onBackPress: () => router.push('/'),
  })
})

onBeforeUnmount(() => {
  stopGamepadWatch?.()
  room?.leave()
  game?.destroy(true)
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
  background: rgba(10, 20, 25, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
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
  color: #6fd98a;
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

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
.touch-controls__buttons {
  position: absolute;
  right: calc(16px + env(safe-area-inset-right, 0px));
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.touch-controls__row {
  display: flex;
  gap: 10px;
}
.touch-btn {
  pointer-events: auto;
  width: 66px;
  height: 66px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.15;
  text-align: center;
  padding: 4px;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.touch-btn--fire {
  border: 2px solid rgba(224, 90, 90, 0.7);
  background: rgba(175, 61, 61, 0.55);
}
.touch-btn--action {
  border: 2px solid rgba(111, 217, 138, 0.75);
  background: rgba(47, 125, 79, 0.6);
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
  background: #0a1f28;
}
.world-frame {
  position: absolute;
  inset: 0;
}
.world-canvas { width: 100%; height: 100%; }
</style>
