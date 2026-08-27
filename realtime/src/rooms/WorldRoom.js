import { Room } from '@colyseus/core'
import { ArraySchema, MapSchema } from '@colyseus/schema'
import { Player, Island, CargoDrop, createWorldState } from '../schema/WorldState.js'
import { loadShip, saveShip, awardBounty, applyDeathPenalty, claimCargoProducts, loadShipCannonLevels } from '../db.js'
import { verifyToken, laravelPost, laravelGetPorts } from '../auth.js'
import { generateIslands } from '../worldgen.js'

// Mirrors config/ships.php — duplicated because Laravel owns ship *type*
// stats and this service only needs these two numbers per type. If it
// drifts, HP bars/speed lie; keep it in sync by hand until there's a
// shared-constants package. Order matters here — it's the weak-to-strong
// tier ladder the threat-by-distance weighting below climbs.
const SHIP_TYPES = ['boat', 'schooner', 'caravel', 'brig', 'frigate', 'galleon', 'corvette', 'battleship']
const SHIP_MAX_HP = {
  boat: 500, schooner: 1000, caravel: 2000, brig: 2300,
  frigate: 4000, galleon: 6500, corvette: 6700, battleship: 10000,
}
const SHIP_SPEED_MULT = {
  boat: 0.75, schooner: 0.75, caravel: 0.75, brig: 0.75,
  frigate: 1.0, galleon: 1.25, corvette: 2.0, battleship: 1.5,
}
// Mirrors config/ships.php's cannon_count — always split evenly in two by
// handleFire below (first half of slots = left broadside, second half =
// right), so it needs to actually match what Ship::ensureCannonSlots (PHP)
// creates, or a client's cannon list and the server's idea of "how many
// guns actually fire" would disagree.
const SHIP_CANNON_COUNT = {
  boat: 6, schooner: 10, caravel: 14, brig: 16,
  frigate: 20, galleon: 24, corvette: 18, battleship: 30,
}
// Mirrors config/cannons.php — see that file's own comment for the
// calibration damage/range are built to satisfy (tier N's maxed cannon
// lands just under tier N+1's level-1) and for why speed is deliberately
// NOT on that same curve (a Galleon's ball read as a pistol shot when it
// was). Each cannon on a side now fires its OWN ball with its OWN
// damage/range/speed (see broadsideCannons/handleFire) — no more
// summing/averaging into one aggregate shot.
//
// range was originally 260/355/484/660/900/1227/1000/1673 — kept the same
// ~×1.36-per-tier ratios (so the level-vs-next-tier calibration above still
// holds) but scaled down by roughly ×0.3 across the board. At the old
// numbers a Galleon could hit something roughly half a typical screen
// away — you'd never even see what shot you. These keep the same relative
// identity (Battleship still reaches furthest, Corvette still trades range
// for its speed) at distances that actually fit on screen.
const CANNON_BASE = {
  boat: { damage: 15, range: 78, speed: 600 },
  schooner: { damage: 20, range: 107, speed: 650 },
  caravel: { damage: 27, range: 145, speed: 700 },
  brig: { damage: 37, range: 198, speed: 750 },
  frigate: { damage: 50, range: 270, speed: 820 },
  galleon: { damage: 69, range: 368, speed: 900 },
  corvette: { damage: 55, range: 300, speed: 1600 },
  battleship: { damage: 94, range: 502, speed: 1000 },
}
const CANNON_LEVEL_BONUS_FRACTION = 0.1
// How wide one broadside's volley fans out, in radians either side of the
// dead-center aim line — these are real individual gun barrels along the
// hull, not one wide blast, so this stays narrow. Mirrored client-side
// (WorldPage.vue's CANNON_SPREAD_HALF_ANGLE) purely for the aim-hold
// preview to actually match what's about to fire; the server never trusts
// the client's copy for anything that matters (hit resolution below uses
// this value directly).
const CANNON_SPREAD_HALF_ANGLE = 0.16
// Reload is a fourth upgradeable stat, but deliberately NOT scaled like the
// other three (see config/cannons.php's own comment) — same base cooldown
// on every hull, a small flat per-level cut, so a maxed Battleship still
// fires like a broadside and not a machine gun.
const RELOAD_BASE_MS = 900
const RELOAD_LEVEL_BONUS_FRACTION = 0.02
const AUTOSAVE_INTERVAL_MS = 10000

// Mirrors config/products.php's keys — bots don't have a real persisted
// cargo hold, so this is what a merchant of that size is assumed to be
// carrying, rolled fresh at the moment it goes down.
const PRODUCT_TYPES = ['rum', 'silk', 'water', 'food', 'leather', 'wood', 'tobacco', 'coffee']

// A human sinking loses a slice of gold/cargo/crew and respawns at a random
// port, not full-HP at the map center — same "sinking costs something real"
// principle as bot loot, now pointed back at the player.
const DEATH_LOSS_MIN = 0.05
const DEATH_LOSS_MAX = 0.15
const DEATH_RESPAWN_HP_FRACTION = 0.5

// Flat global distribution — every bot everywhere rolls against the same
// table, not gated by distance from spawn (that used to mean a bot
// anywhere near spawn was ALWAYS a Boat, which is exactly why bots read as
// uniformly weak — direct feedback, exact percentages requested).
const BOT_SHIP_TYPE_WEIGHTS = {
  boat: 30, schooner: 24, caravel: 17, brig: 11,
  frigate: 7, galleon: 5, corvette: 4, battleship: 2,
}

// Keep in sync with MAP_SIZE in web/src/pages/WorldPage.vue until these two
// packages share a constants module. Islands themselves are no longer
// hand-placed here — see generateIslands()/onCreate(), synced to clients via
// state.islands.
const MAP_SIZE = 4800
const SPAWN = { x: 2400, y: 2400 }
// Must match SHORE_POINT_COUNT in worldgen.js — that's how many boundary
// samples each island's `points` array has, evenly spaced around the circle.
const SHORE_POINT_COUNT = 16

// Keep in sync with ABORDAGE_RANGE in web/src/pages/WorldPage.vue — the
// client's proximity check for showing the button and this server-side
// check for actually honoring a challenge need to agree, or a client could
// show/hide the button while the server silently accepts/rejects the
// opposite.
const ABORDAGE_RANGE = 70
// Keep in sync with PORT_ENTER_RANGE in web/src/pages/WorldPage.vue — a bot
// safe-zone that's tighter than the client's own "enter port" prompt radius
// would mean a ship could be shown the button while still getting shot at.
const PORT_ENTER_RANGE = 220

// A sunk ship's gold + cargo floats here instead of landing straight in the
// killer's account — see spawnCargoDrop/tickCargoDrops. Pickup range is
// generous next to ABORDAGE_RANGE's "вплотную" since this is a race to
// reach a fixed point, not a lunge at a moving target.
const CARGO_PICKUP_RANGE = 140
// Was 60s — too tight for the exact case this "partial fit stays behind"
// design was built for: couldn't take it all, sail to port, sell to free
// up the hold, sail back for the rest. A real round trip plus shopping
// routinely outlasts a minute, so the drop was gone before anyone could
// reasonably act on what it left behind (direct feedback).
const CARGO_DROP_TTL_MS = 120000
// A cannonball is a real object that travels and can miss — see
// tickCannonballs(). Range/speed used to be flat constants here (matching
// ones in WorldPage.vue); now each ball carries its own, from the
// shooter's actual cannons (see broadsideStats/CANNON_BASE) — the client's
// visual tween just mirrors whatever this side actually decided, same as
// it always has for damage.
const CANNONBALL_HIT_RADIUS = 26

const TARGET_BOT_COUNT = 100
const BOT_AGGRESSIVE_CHANCE = 0.12
const BOT_RESPAWN_DELAY_MS = 4000
// Must match SHIP_SPEED in web/src/pages/WorldPage.vue — a bot and a human
// sailing the same hull type should move at the same real speed. This used
// to be a separate, lower number (150 vs the player's 220) plus a 0.5x
// patrol penalty below, which could make a patrolling Corvette bot slower
// than a player's own Boat — exactly backwards from what SHIP_SPEED_MULT
// says should happen.
const BOT_SPEED = 220
// Was 320 (before that, 500) — with the new fight-or-flee system (see
// SHIP_POWER/shouldBotEngage) a bot's OWN judgment already decides whether
// it's worth chasing, so a tight range isn't doing much load-bearing
// "don't be an omniscient bully" work anymore; it just meant a real
// engagement circle too small to actually chase or flee inside of before
// hitting the range wall — 3x wider (direct feedback).
const BOT_AGGRO_RANGE = 960
// With 100 bots on the map, a relay of different aggressive ones drifting
// in and out of range read as one endless, un-losable chase — a bot now
// gives up after a bounded chase, same as the original's AI not being
// infinitely persistent, and won't re-engage anyone for a cooldown after.
const BOT_MAX_CHASE_MS = 15000
const BOT_GIVE_UP_COOLDOWN_MS = 6000
// "How much of a threat is this ship" — HP × total broadside damage (both
// cannons of one side firing at once), the classic "how many exchanges can
// it win" combat-power heuristic. Only ever used to weigh a BOT's own
// fight-or-flee odds (see shouldBotEngage/nearbyHostilePower) — never
// touches actual combat resolution, that's still purely handleFire/
// broadsideCannons/tickCannonballs. Computed by hand from SHIP_MAX_HP ×
// (SHIP_CANNON_COUNT/2 × CANNON_BASE.damage) — keep in sync if any of
// those three change.
const SHIP_POWER = {
  boat: 22500, schooner: 100000, caravel: 378000, brig: 680800,
  frigate: 2000000, galleon: 5382000, corvette: 3316500, battleship: 14100000,
}
// A real player should win a fair fight against an equal-tier bot more
// often than not — bots fought at even odds (~50/50, see the balance-sim
// results) made "you and it are the same size" feel like a coinflip
// instead of a real fight to win. Cannon damage only (not HP, not the
// engage/flee judgment below) — bots are simply worse gunners than a real
// captain, not smaller ships. Applied in broadsideCannons.
const BOT_DAMAGE_MULT = 0.8
// Steepness of the engage/flee sigmoid (see shouldBotEngage) — ratio=1
// (evenly matched) lands at 50%, ratio=2 at 80%, ratio=0.5 at 20%, ratio=4
// at 94%, ratio=0.25 at 6%. Clamped so neither a hopeless nor a trivial
// fight is ever a hard 0% or 100% — even a Шлюпка occasionally takes a
// swing at a Линкор, and a Линкор occasionally lets a Шлюпка go (its cargo
// isn't worth the trouble).
const BOT_ENGAGE_POWER_EXPONENT = 2
const BOT_ENGAGE_CHANCE_MIN = 0.03
const BOT_ENGAGE_CHANCE_MAX = 0.97
// A wounded ship runs regardless of how the fight started or how good the
// odds looked at the time — re-checked every tick a bot is in combat, see
// tickBots.
const BOT_LOW_HP_FLEE_FRACTION = 0.28
// How far a fleeing bot will bother detouring toward a port instead of
// just sailing straight away from the threat — real safety beats a random
// direction, but not if the nearest one is halfway across the map.
const BOT_FLEE_PORT_SEARCH_RANGE = 1800
// Reaching safety (port, or just enough distance) doesn't mean "back to
// business" the instant it happens — same giveUpUntil cooldown the
// existing chase-timeout already uses, just a bit longer: this bot was
// actually losing a fight a moment ago, not merely failing to catch
// someone, so it takes longer to calm down before it'll wander back out
// or size up another target. A bot that actually made it INTO a port
// during this (see tickBots) also gets healed to full for free right
// then — no gold, no ship menu, it's a bot, but "sailed into harbor,
// patched up, sailed back out" beats a permanently half-dead patrol NPC.
const BOT_FLEE_RECOVER_MS = 20000
// Fraction of the remaining angle closed per tick, at 60 ticks/sec. Was
// 0.06 originally (too slow — a circling player could keep the bot's
// broadside from ever lining up), bumped to 0.22 to fix that — which
// overshot the other way: 0.22/tick closes a full 90°-to-firing-range turn
// in well under 200ms, faster than a human can react at all, so 1-on-1 the
// bot always won regardless of input device. 0.10 still turns fast enough
// that circling doesn't trivially escape it (~350ms to lock on from a bad
// angle), but leaves a real window to dodge or reposition before it fires.
const BOT_TURN_LERP = 0.10
const BOT_HEADING_CHANGE_MS = 3000 // matches the original's Move_Random timer
const LOOKAHEAD_DISTANCE = 220 // ~1.5s of patrol travel — enough runway to turn away before visibly touching anything
const LOOKAHEAD_TRIES = 8 // random headings sampled when steering away from an obstacle

function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b))
}

function pointAhead(x, y, heading, distance) {
  return { x: x + Math.sin(heading) * distance, y: y - Math.cos(heading) * distance }
}

// Linear-interpolates the island's wobbly shore boundary (its `points`
// samples, evenly spaced around the circle — see genShore in worldgen.js) at
// an arbitrary angle, instead of only knowing the boundary at the 16 sampled
// angles.
function islandBoundaryRadius(island, angle) {
  const twoPi = Math.PI * 2
  const norm = ((angle % twoPi) + twoPi) % twoPi
  const scaled = (norm / twoPi) * SHORE_POINT_COUNT
  const i0 = Math.floor(scaled) % SHORE_POINT_COUNT
  const i1 = (i0 + 1) % SHORE_POINT_COUNT
  const t = scaled - Math.floor(scaled)
  const r0 = island.points[i0]
  const r1 = island.points[i1]
  return r0 + (r1 - r0) * t
}

// First-run skeleton: one shared room for the whole map. Client-reported
// position is trusted for human players (no anti-cheat yet — a later
// concern), but damage is always computed and applied here from the
// server's own copy of that state, never taken as a claim from the
// attacking client. Bot movement is fully server-authoritative — there's no
// client to trust or not trust for those.
export class WorldRoom extends Room {
  onCreate() {
    // Colyseus disposes a room ~1s after its last real client disconnects
    // (autoDispose defaults to true) — fine for a disposable match, fatal
    // for the one persistent shared world every client always matchmakes
    // into (see index.js's /matchmake/world stub). Every bot, in-flight
    // cannonball, and CargoDrop was getting wiped and the room silently
    // recreated from scratch any time the player count briefly hit zero —
    // which, well short of actually empty, is exactly what happens for a
    // moment every time a lone player leaves the world for a port (that
    // navigation fully disconnects — see WorldPage.vue's onBeforeUnmount)
    // and nobody else happens to be online. Reported as "loot from a kill
    // near a port vanished in under a minute" — the real bug was much
    // bigger than the timer it looked like.
    this.autoDispose = false
    this.setState(createWorldState())

    for (const { x, y, baseRadius, points } of generateIslands(MAP_SIZE)) {
      const island = new Island()
      island.x = x
      island.y = y
      island.baseRadius = baseRadius
      island.points = new ArraySchema(...points)
      this.state.islands.push(island)
    }

    this.lastFiredAt = new Map() // `${attackerId}:${side}` -> timestamp
    // sessionId -> array of per-slot levels, loaded once on join (see
    // loadShipCannonLevels's own comment for why that's safe) — bots never
    // get an entry, handleFire falls back to a flat table for them instead.
    this.playerCannonLevels = new Map()
    this.botRuntime = new Map() // botId -> { mode, headingChangedAt }
    this.botCounter = 0
    this.cannonballs = [] // in-flight balls — see tickCannonballs()
    this.cargoDropCounter = 0
    // Serializes claims per-drop across the async DB round-trip in
    // claimCargoDrop — without it, two players detected within the same
    // tick (before either's await resolves) could both be granted the same
    // still-full crate. Plain JS Set, not synced state — purely a lock.
    this.dropsBeingClaimed = new Set()

    // Not awaited — bots simply won't respect port safe zones for the
    // handful of milliseconds until this resolves, harmless at room start.
    this.ports = []
    laravelGetPorts()
      .then((ports) => {
        // Port coordinates now sit near the shore on the island itself (see
        // the migration notes) — fine for the marker (and for the safe-zone
        // radius check, which should match what the client's own "enter
        // port" button uses), but a death-respawn right there would drop a
        // player onto land. spawnX/Y is the nearest clear water along the
        // same island-center-to-port ray — kept separate from x/y on
        // purpose, not overwriting the marker position.
        this.ports = ports.map((port) => {
          const water = this.findWaterNear(port.x, port.y)
          return { ...port, spawnX: water.x, spawnY: water.y }
        })
      })
      .catch((e) => console.error('laravelGetPorts failed', e))

    this.onMessage('move', (client, { x, y, rotation }) => {
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      player.x = x
      player.y = y
      player.rotation = rotation
    })

    this.onMessage('fire', (client, { side }) => {
      if (side !== 'left' && side !== 'right') return
      this.handleFire(client.sessionId, side, Date.now(), client)
    })

    this.onMessage('abordage_challenge', (client, { targetSessionId }) => {
      this.startPvpAbordage(client, targetSessionId).catch((e) => console.error('abordage_challenge failed', e))
    })

    // PortModal.vue awaits this before opening — Laravel's own port
    // endpoints (PortController/GunsmithController proximityError) check
    // this player's x/y straight from the `ships` table, which normally
    // only gets this fresh via the AUTOSAVE_INTERVAL_MS(10s) tick or on
    // disconnect (see onLeave/autosaveHumans). The old routed '/port/:id'
    // page got a free fresh save for this exact reason — leaving the room
    // to navigate there triggered onLeave's own saveShip. Now that a port
    // visit never leaves the room at all (see PortModal.vue's own
    // comment), something has to force that save explicitly instead, or a
    // player who just arrived could get wrongly told they're "not at this
    // port" for up to 10 seconds.
    this.onMessage('save_position', (client) => {
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      saveShip(player.userId, player)
        .then(() => client.send('position_saved'))
        .catch((e) => console.error('save_position failed', e))
    })

    // Sent by WorldPage.vue the instant PortModal closes. Everything a port
    // visit can change — repair (hp), buying a new hull (shipType/maxHp),
    // Оружейник upgrades (playerCannonLevels) — happens over plain Laravel
    // HTTP calls, not through this room, so the live Player here was
    // otherwise stuck holding whatever it loaded at onJoin until the player
    // fully disconnected and reconnected. The old routed '/port/:id' page
    // got that refresh for free (leaving the room to navigate there, then
    // rejoining fresh on the way back); a modal that never leaves the room
    // needs to ask for it explicitly instead. Combat can't touch a docked
    // player anyway (see isNearAnyPort in findCannonballHit), so refreshing
    // once here — rather than after every single port action — is enough.
    this.onMessage('refresh_ship', (client) => {
      const player = this.state.players.get(client.sessionId)
      if (!player) return
      this.refreshShipFromDb(client.sessionId, player)
        .then(() => this.sendBroadsideStats(client, player.shipType, client.sessionId))
        .catch((e) => console.error('refresh_ship failed', e))
    })

    for (let i = 0; i < TARGET_BOT_COUNT; i++) this.spawnBot()
    this.setSimulationInterval((deltaMs) => {
      this.tickBots(deltaMs)
      this.tickCannonballs(deltaMs)
      this.tickCargoDrops()
    })
    this.clock.setInterval(() => this.autosaveHumans(), AUTOSAVE_INTERVAL_MS)
  }

  // ---- islands ----

  isBlocked(x, y) {
    const edgeMargin = 20
    return this.collidesWithIsland(x, y) || x <= edgeMargin || x >= MAP_SIZE - edgeMargin || y <= edgeMargin || y >= MAP_SIZE - edgeMargin
  }

  collidesWithIsland(x, y) {
    for (const island of this.state.islands) {
      const dist = Math.hypot(x - island.x, y - island.y)
      const boundary = islandBoundaryRadius(island, Math.atan2(y - island.y, x - island.x))
      if (dist < boundary + 20) return true
    }
    return false
  }

  // Walks outward from the nearest island's center, through (x, y), until
  // clear of land — used to turn a port's on-shore marker position into a
  // safe water point nearby (see the ports.then() in onCreate).
  findWaterNear(x, y) {
    let nearest = null
    let nearestDist = Infinity
    for (const island of this.state.islands) {
      const d = Math.hypot(x - island.x, y - island.y)
      if (d < nearestDist) {
        nearestDist = d
        nearest = island
      }
    }
    if (!nearest) return { x, y }

    const angle = Math.atan2(y - nearest.y, x - nearest.x)
    let r = nearestDist
    while (this.collidesWithIsland(nearest.x + Math.cos(angle) * r, nearest.y + Math.sin(angle) * r) && r < nearestDist + 600) {
      r += 20
    }
    return { x: nearest.x + Math.cos(angle) * r, y: nearest.y + Math.sin(angle) * r }
  }

  // Runs before onJoin — rejecting here (throwing) refuses the connection
  // entirely, so an invalid/expired token never gets a room seat at all.
  async onAuth(client, options) {
    const user = await verifyToken(options?.token)
    if (!user) throw new Error('Invalid or expired token')
    // Carried through to onJoin so PvP abordage can act on this player's
    // behalf later (see laravelPost) without a separate service-auth scheme.
    return { ...user, _token: options.token }
  }

  async onJoin(client) {
    const userId = client.auth.id

    // One live ship per account — logging in on a second device while
    // already connected elsewhere (phone while the PC tab is still open,
    // say) used to spawn a second independent Player for the same userId,
    // silently diverging from and racing to overwrite the same DB row.
    // Newest connection wins: the old session is told why and disconnected
    // cleanly, its last position saved, before the new one loads anything.
    for (const [sessionId, existing] of this.state.players.entries()) {
      if (existing.isBot || existing.userId !== userId) continue
      await saveShip(userId, existing)
      this.state.players.delete(sessionId)
      const oldClient = this.clients.find((c) => c.sessionId === sessionId)
      oldClient?.send('kicked', { reason: 'duplicate_login' })
      oldClient?.leave()
    }

    const saved = await loadShip(userId)

    // The whole point of buying a bigger hull in port: it has to actually
    // change something out here, not just a row nothing reads.
    const shipType = saved?.type ?? 'boat'

    const player = new Player()
    player.x = saved?.x ?? SPAWN.x
    player.y = saved?.y ?? SPAWN.y
    player.rotation = 0
    player.shipType = shipType
    player.maxHp = SHIP_MAX_HP[shipType] ?? SHIP_MAX_HP.boat
    player.hp = saved?.hp ?? player.maxHp
    player.firstName = client.auth.first_name ?? 'Player'
    player.isBot = false
    player.userId = userId
    player.authToken = client.auth._token
    this.state.players.set(client.sessionId, player)

    this.playerCannonLevels.set(client.sessionId, await loadShipCannonLevels(userId))
    this.sendBroadsideStats(client, shipType, client.sessionId)
  }

  /** Re-reads shipType/maxHp/hp/cannon levels from the DB into an already-live Player — see the 'refresh_ship' handler's own comment for why this needs to exist at all. Same fields onJoin sets from the same loadShip/loadShipCannonLevels calls, just applied to an existing player instead of a fresh one. */
  async refreshShipFromDb(sessionId, player) {
    const saved = await loadShip(player.userId)
    if (!saved) return
    player.shipType = saved.type
    player.maxHp = SHIP_MAX_HP[saved.type] ?? SHIP_MAX_HP.boat
    player.hp = saved.hp
    this.playerCannonLevels.set(sessionId, await loadShipCannonLevels(player.userId))
  }

  /**
   * Pushes both broadsides' real current range to the client, already
   * translated to the UI-facing fireLeft/fireRight naming (the same
   * inversion the 'fired' broadcast uses) — WorldPage.vue's aim-hold
   * preview (lastKnownRange) otherwise only ever learned a side's range
   * from that side's OWN first 'fired' broadcast, which meant a side that
   * hadn't fired yet THIS session showed the small DEFAULT_AIM_RANGE
   * fallback even on a ship whose real range was much bigger — an
   * intermittent-feeling bug that was really just "whichever side you
   * haven't fired from yet" (direct feedback: fired right, aimed left,
   * got a tiny cone; fired left once, then it was correct). Called right
   * after anything that could change either side's real range: onJoin and
   * 'refresh_ship' (cannon upgrades, a new hull).
   */
  sendBroadsideStats(client, shipType, sessionId) {
    const right = this.broadsideCannons(shipType, sessionId, 'right')
    const left = this.broadsideCannons(shipType, sessionId, 'left')
    client.send('broadside_stats', {
      fireLeft: { range: Math.max(...right.cannons.map((c) => c.range)) },
      fireRight: { range: Math.max(...left.cannons.map((c) => c.range)) },
    })
  }

  async onLeave(client) {
    const player = this.state.players.get(client.sessionId)
    this.state.players.delete(client.sessionId)
    this.playerCannonLevels.delete(client.sessionId)
    if (player) await saveShip(player.userId, player)
  }

  async autosaveHumans() {
    for (const player of this.state.players.values()) {
      if (!player.isBot) await saveShip(player.userId, player)
    }
  }

  /**
   * No accept/decline step, deliberately — boarding is a surprise attack,
   * same "no consent needed" model naval cannon fire already has here.
   * Laravel (via the challenger's own token) is the one that actually
   * creates the fight and computes both captains' stats; this just checks
   * the two are close enough and tells both clients where to go.
   */
  async startPvpAbordage(client, targetSessionId) {
    const challenger = this.state.players.get(client.sessionId)
    const target = this.state.players.get(targetSessionId)
    if (!challenger || !target || target.isBot || challenger.isBot) return

    // Same safe zone bots already respect (see isNearAnyPort) — either side
    // being close enough to dock blocks the boarding, not just the target's
    // side: sitting in port territory yourself shouldn't be a free pass to
    // jump someone else either.
    if (this.isNearAnyPort(challenger.x, challenger.y) || this.isNearAnyPort(target.x, target.y)) {
      client.send('abordage_rejected', { reason: 'in_port_zone' })
      return
    }

    // ABORDAGE_RANGE (70) is intentionally tight ("вплотную"), and the
    // client only shows the prompt once it's already this close — but a
    // moving target plus the round-trip to get here is enough to have
    // sailed back out of range by now. Used to just silently do nothing,
    // which from the challenger's side looked exactly like a broken
    // feature (target sails on, no explanation) rather than a clean miss.
    const distance = Math.hypot(target.x - challenger.x, target.y - challenger.y)
    if (distance > ABORDAGE_RANGE) {
      client.send('abordage_rejected', { reason: 'out_of_range' })
      return
    }

    const result = await laravelPost('/abordage/pvp', challenger.authToken, { opponent_user_id: target.userId })
    if (!result?.abordage) {
      client.send('abordage_rejected', { reason: 'server_error' })
      return
    }

    client.send('abordage_started', { abordageId: result.abordage.id })
    this.clients.find((c) => c.sessionId === targetSessionId)?.send('abordage_started', { abordageId: result.abordage.id })
  }

  // ---- bots ----

  spawnBot() {
    const id = `bot-${this.botCounter++}`

    let x, y
    do {
      x = 100 + Math.random() * (MAP_SIZE - 200)
      y = 100 + Math.random() * (MAP_SIZE - 200)
    } while (this.collidesWithIsland(x, y))

    const shipType = this.pickBotShipType()
    // Aggressive bots hunt anyone in aggro range, unprompted — original
    // Move_in_Battle behavior. Calm ones stay in patrol and ignore players
    // entirely until one of them actually opens fire, then fight back at
    // that specific attacker (not the nearest player, whoever provoked it).
    const temperament = Math.random() < BOT_AGGRESSIVE_CHANCE ? 'aggressive' : 'calm'

    const bot = new Player()
    bot.x = x
    bot.y = y
    bot.rotation = Math.random() * Math.PI * 2
    bot.maxHp = SHIP_MAX_HP[shipType]
    bot.shipType = shipType
    bot.hp = bot.maxHp
    bot.firstName = 'Бот'
    bot.isBot = true
    bot.temperament = temperament
    this.state.players.set(id, bot)

    this.botRuntime.set(id, {
      mode: 'patrol', headingChangedAt: Date.now(), shipType, temperament, provokedBy: null,
      // engageRollTargetId/engageRollResult: cached fight-or-ignore roll for
      // aggressive bots (see pickBotTarget). fleeing: currently running from
      // its target instead of fighting (see tickBots/shouldBotEngage).
      engageRollTargetId: null, engageRollResult: false, fleeing: false,
    })
  }

  respawnBotLater(botId) {
    this.state.players.delete(botId)
    this.botRuntime.delete(botId)
    this.clock.setTimeout(() => this.spawnBot(), BOT_RESPAWN_DELAY_MS)
  }

  /** Straight roll against BOT_SHIP_TYPE_WEIGHTS — see its own comment. */
  pickBotShipType() {
    const total = Object.values(BOT_SHIP_TYPE_WEIGHTS).reduce((a, b) => a + b, 0)
    let roll = Math.random() * total
    for (const type of SHIP_TYPES) {
      roll -= BOT_SHIP_TYPE_WEIGHTS[type]
      if (roll <= 0) return type
    }
    return SHIP_TYPES[0]
  }

  /**
   * A bot has no persisted hold — this is what a merchant of that tier is
   * assumed to be carrying, rolled at the moment it sinks. 2-4 of the 8
   * product types, quantity scaled by tier. Every bot death now drops the
   * whole thing into a CargoDrop for whoever reaches it first (see
   * resolveHit) rather than a private instant reward, so there's no
   * LOOT_LOSS reduction anymore — that existed to make a free, guaranteed,
   * un-contested reward feel less free; a race for a 60-second floating
   * crate already costs something (getting there first).
   *
   * amount was (5 + rand(16)) * (tier + 1) — a single Boat-tier kill
   * already averaged ~210 weight (products.php's weights, mixed with the
   * ~3-item spread above), well over half a Шлюпка's own 350 capacity in
   * ONE drop (direct feedback: holds filled after a kill or two). Both
   * the per-roll spread and the tier multiplier's growth are cut here —
   * (3 + rand(6)) instead of (5 + rand(16)), and a gentler 1 + tier*0.4
   * instead of a flat tier+1 — landing a same-tier kill around ~15-25% of
   * that tier's OWN capacity instead of ~50-60%.
   */
  generateBotCargo(tier) {
    const shuffled = [...PRODUCT_TYPES].sort(() => Math.random() - 0.5)
    const productCount = 2 + Math.floor(Math.random() * 3)

    const items = {}
    for (const type of shuffled.slice(0, productCount)) {
      const amount = Math.round((3 + Math.floor(Math.random() * 6)) * (1 + tier * 0.4))
      if (amount > 0) items[type] = amount
    }
    return items
  }

  // Same idea as the port page itself being a safe zone (leaving the room
  // entirely) but extended to the moment the "enter port" prompt would
  // already be showing on the client — a ship that's effectively docked
  // shouldn't still be getting shot at from the water.
  isNearAnyPort(x, y) {
    return this.ports.some((port) => Math.hypot(port.x - x, port.y - y) <= PORT_ENTER_RANGE)
  }

  nearestHumanTarget(bot) {
    let nearest = null
    let nearestDist = Infinity
    for (const [id, player] of this.state.players) {
      if (player.isBot) continue
      if (this.isNearAnyPort(player.x, player.y)) continue
      const dist = Math.hypot(player.x - bot.x, player.y - bot.y)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = { id, player, dist }
      }
    }
    return nearest
  }

  /**
   * Aggressive bots go after whoever's nearest — but only if they actually
   * like their odds (see shouldBotEngage): a Шлюпка noticing a Линкор
   * doesn't charge it just because it's the closest thing around. Rolled
   * once per (bot, target) pair, cached on runtime, not re-rolled every
   * tick — otherwise a borderline power ratio would flicker between
   * chasing and ignoring from one frame to the next. A declined target
   * stays declined (this bot just isn't picking that fight) until a
   * different human becomes the nearest one instead.
   *
   * Calm ones ignore everyone until provoked, then only ever chase that
   * specific attacker — they don't switch targets just because someone
   * else got closer, and they naturally stop caring once that attacker
   * leaves aggro range (no separate "forgive" timer needed, the existing
   * range check covers it).
   */
  pickBotTarget(bot, runtime) {
    if (runtime.temperament === 'aggressive') {
      const nearest = this.nearestHumanTarget(bot)
      if (!nearest) return null
      if (runtime.engageRollTargetId !== nearest.id) {
        runtime.engageRollTargetId = nearest.id
        runtime.engageRollResult = this.shouldBotEngage(bot, this.nearbyHostilePower(bot))
      }
      return runtime.engageRollResult ? nearest : null
    }

    if (!runtime.provokedBy) return null
    const attacker = this.state.players.get(runtime.provokedBy)
    if (!attacker || this.isNearAnyPort(attacker.x, attacker.y)) {
      runtime.provokedBy = null
      return null
    }
    return { id: runtime.provokedBy, player: attacker, dist: Math.hypot(attacker.x - bot.x, attacker.y - bot.y) }
  }

  /**
   * Sigmoid on the power ratio (myPower/enemyPower) — see
   * BOT_ENGAGE_POWER_EXPONENT's own comment for the actual breakpoints.
   * Shared by every fight-or-flee decision a bot makes (whether to chase a
   * new target, whether to fight back when hit, whether to keep fighting)
   * so a ship's willingness to fight is symmetric regardless of which side
   * threw the first punch.
   */
  shouldBotEngage(bot, enemyPower) {
    const myPower = SHIP_POWER[bot.shipType] ?? SHIP_POWER.boat
    const ratio = myPower / Math.max(1, enemyPower)
    const r = Math.pow(ratio, BOT_ENGAGE_POWER_EXPONENT)
    const chance = Math.min(BOT_ENGAGE_CHANCE_MAX, Math.max(BOT_ENGAGE_CHANCE_MIN, r / (r + 1)))
    return Math.random() < chance
  }

  /**
   * Total SHIP_POWER of every human within BOT_AGGRO_RANGE of this bot
   * (ported ones excluded — they're not a threat, they're docked) — what a
   * bot actually weighs its odds against, not just whichever single human
   * it happens to be looking at. A Каравелла isn't spooked by 2 Шлюпки
   * ganging up (their combined power is still a fraction of its own), but
   * a Шлюпка facing even one Каравелла correctly reads that as hopeless —
   * same formula, the ratio just does the work either way.
   */
  nearbyHostilePower(bot) {
    let total = 0
    for (const [, player] of this.state.players) {
      if (player.isBot) continue
      if (this.isNearAnyPort(player.x, player.y)) continue
      if (Math.hypot(player.x - bot.x, player.y - bot.y) > BOT_AGGRO_RANGE) continue
      total += SHIP_POWER[player.shipType] ?? SHIP_POWER.boat
    }
    return total
  }

  /** Nearest port within maxDist, or null — used by fleeStep to head for actual safety instead of just away from the threat, only when one's close enough to matter. */
  nearestPortWithin(bot, maxDist) {
    let best = null
    let bestDist = Infinity
    for (const port of this.ports) {
      const dist = Math.hypot(port.x - bot.x, port.y - bot.y)
      if (dist < bestDist && dist <= maxDist) {
        bestDist = dist
        best = port
      }
    }
    return best
  }

  tickBots(deltaMs) {
    const now = Date.now()

    for (const [botId, bot] of this.state.players) {
      if (!bot.isBot) continue
      const runtime = this.botRuntime.get(botId)
      if (!runtime) continue

      if (runtime.giveUpUntil && now < runtime.giveUpUntil) {
        this.patrolStep(bot, runtime, now, deltaMs)
        continue
      }

      const target = this.pickBotTarget(bot, runtime)
      const inRange = target && target.dist <= BOT_AGGRO_RANGE

      if (!inRange) {
        runtime.chaseStartedAt = null
        runtime.fleeing = false
        this.patrolStep(bot, runtime, now, deltaMs)
        continue
      }

      if (!runtime.chaseStartedAt) runtime.chaseStartedAt = now
      if (now - runtime.chaseStartedAt > BOT_MAX_CHASE_MS) {
        // Chased long enough without landing the kill — break off and stop
        // caring about anyone for a while, rather than immediately
        // re-locking onto the same (or another) nearby target next tick.
        runtime.chaseStartedAt = null
        runtime.giveUpUntil = now + BOT_GIVE_UP_COOLDOWN_MS
        if (runtime.temperament === 'calm') runtime.provokedBy = null
        this.patrolStep(bot, runtime, now, deltaMs)
        continue
      }

      // A wounded ship runs regardless of how the fight started or how
      // good the odds looked at the time (see shouldBotEngage) — checked
      // every tick a bot is actually in range of its target, not just once
      // at the moment it was provoked.
      if (bot.hp / bot.maxHp < BOT_LOW_HP_FLEE_FRACTION) runtime.fleeing = true

      if (runtime.fleeing) {
        if (this.isNearAnyPort(bot.x, bot.y)) {
          // Reached safety — same "cool off before caring about anyone
          // again" shape as a timed-out chase just above, only longer:
          // this bot was actually losing a fight, not merely failing to
          // catch someone (see BOT_FLEE_RECOVER_MS's own comment).
          runtime.fleeing = false
          runtime.chaseStartedAt = null
          runtime.giveUpUntil = now + BOT_FLEE_RECOVER_MS
          bot.hp = bot.maxHp
          if (runtime.temperament === 'calm') runtime.provokedBy = null
          this.patrolStep(bot, runtime, now, deltaMs)
        } else {
          this.fleeStep(bot, runtime, target.player, deltaMs)
        }
        continue
      }

      // Scales per-tier now that cannon range does too (see CANNON_BASE) —
      // a flat engage distance meant a Battleship bot (base range ~1670)
      // sailed needlessly close before ever opening fire, giving up the
      // range advantage its bigger guns are actually supposed to have.
      // Bots always fight at level-0 (no upgrades to load), so their own
      // ship type's base range is the real number to engage off of.
      const engageRange = (CANNON_BASE[bot.shipType] ?? CANNON_BASE.boat).range * 0.85
      // Hysteresis: leaving broadside range needs to clear a wider band than
      // entering it did, or a target sitting right on the boundary flips the
      // bot between "approach" and "broadside" — two very different headings
      // — every single tick, which is exactly the zig-zag that got reported.
      const exitRange = runtime.mode === 'broadside' ? engageRange * 1.25 : engageRange

      if (target.dist > exitRange) {
        runtime.mode = 'approach'
        this.approachStep(bot, runtime, target.player, deltaMs)
      } else {
        runtime.mode = 'broadside'
        this.broadsideStep(botId, bot, runtime, target, now, deltaMs)
      }
    }
  }

  patrolStep(bot, runtime, now, deltaMs) {
    runtime.mode = 'patrol'

    // Proactive, not just reactive: look ahead along the bot's *actual*
    // current facing (what advance() will really move it along, not the
    // target heading it's still turning toward) and steer away before it's
    // close enough to visibly run into a wall or island, instead of only
    // reacting once already blocked at the last tick.
    const courseBlocked = !this.pathClear(bot.x, bot.y, bot.rotation, LOOKAHEAD_DISTANCE)

    if (runtime.heading === undefined || now - runtime.headingChangedAt > BOT_HEADING_CHANGE_MS || courseBlocked) {
      runtime.heading = this.pickClearHeading(bot)
      runtime.headingChangedAt = now
    }

    this.turnToward(bot, runtime.heading)
    // Full speed, not a patrol-only fraction — see the BOT_SPEED comment,
    // a slower patrol pace is exactly what let a wandering Corvette read as
    // slower than a player's own Boat.
    const moved = this.advance(bot, this.botSpeed(runtime), deltaMs)

    if (!moved) {
      // Still got blocked despite steering (e.g. caught mid-turn) — reroll
      // now rather than sitting there until the next scheduled check.
      runtime.heading = this.pickClearHeading(bot)
      runtime.headingChangedAt = now
    }
  }

  /**
   * Samples random headings and keeps the first one whose whole path is
   * clear, rather than a single random guess that's just as likely to point
   * straight back at the same wall or island. Falls back to reversing
   * course if nothing clear turns up — rare (would need to be boxed in on
   * most sides), and wherever the bot just came from is usually safe.
   */
  pickClearHeading(bot) {
    for (let i = 0; i < LOOKAHEAD_TRIES; i++) {
      const candidate = Math.random() * Math.PI * 2
      if (this.pathClear(bot.x, bot.y, candidate, LOOKAHEAD_DISTANCE)) return candidate
    }
    return bot.rotation + Math.PI
  }

  /**
   * Was a single check at the far end of the lookahead — fine for a
   * roughly straight run, but a heading that curls along a coastline
   * (exactly what fleeStep now often needs, heading for a port that's
   * usually sitting right on the shore) could have a clear ENDPOINT while
   * the straight-line path to it still clips a headland in between (direct
   * feedback: a bot "caught on the edge" of an island while fleeing).
   * Samples several points along the segment instead of just the last one.
   */
  pathClear(x, y, heading, distance) {
    const steps = 4
    for (let i = 1; i <= steps; i++) {
      const p = pointAhead(x, y, heading, (distance * i) / steps)
      if (this.isBlocked(p.x, p.y)) return false
    }
    return true
  }

  approachStep(bot, runtime, targetPlayer, deltaMs) {
    // Same convention as everywhere else: rotation = atan2(dy, dx) + 90°, so
    // that Math.sin(rotation)/-Math.cos(rotation) reconstructs the forward
    // vector correctly (see advance() and handleFire()). This had the sign
    // flipped before, which pointed the bot roughly away from its target.
    const heading = Math.atan2(targetPlayer.y - bot.y, targetPlayer.x - bot.x) + Math.PI / 2
    this.turnToward(bot, heading)
    this.advance(bot, this.botSpeed(runtime), deltaMs)
  }

  /**
   * The opposite of approachStep, plus a real destination when one's
   * close enough to bother with — heads for the nearest port within
   * BOT_FLEE_PORT_SEARCH_RANGE (a real captain runs for safe harbor, not
   * open water) and only falls back to a plain "straight away from the
   * threat" heading when no port is close enough to matter.
   */
  fleeStep(bot, runtime, threat, deltaMs) {
    runtime.mode = 'flee'
    const port = this.nearestPortWithin(bot, BOT_FLEE_PORT_SEARCH_RANGE)
    const goalHeading = port
      ? Math.atan2(port.y - bot.y, port.x - bot.x) + Math.PI / 2
      : Math.atan2(bot.y - threat.y, bot.x - threat.x) + Math.PI / 2
    // The straight-line heading toward safety used to be all this did — a
    // port sitting behind an island (or just an island in the way of
    // "straight away from the threat") ran the bot bow-first into the
    // shore and left it stalled there, still "fleeing" but going nowhere
    // (direct feedback). pickHeadingToward steers around it while still
    // generally heading toward the goal, same idea as patrol's own
    // obstacle check just biased toward a direction instead of random.
    const heading = this.pickHeadingToward(bot, goalHeading)
    this.turnToward(bot, heading)
    this.advance(bot, this.botSpeed(runtime), deltaMs)
  }

  /**
   * Like pickClearHeading, but biased toward a specific goal direction
   * instead of a uniformly random guess — tries the direct heading first,
   * then increasingly wide offsets to either side, so a bot skirting
   * around an island still generally continues toward its goal instead of
   * wherever a random reroll happens to point. Recomputed fresh every
   * tick (cheap, deterministic given the current position) rather than
   * cached — no separate "reroll on failure" handling needed the way
   * patrol's random pick required.
   */
  pickHeadingToward(bot, goalHeading) {
    if (this.pathClear(bot.x, bot.y, goalHeading, LOOKAHEAD_DISTANCE)) return goalHeading
    for (const offsetDeg of [15, 30, 45, 60, 90, 120, 150]) {
      for (const sign of [1, -1]) {
        const candidate = goalHeading + ((offsetDeg * Math.PI) / 180) * sign
        if (this.pathClear(bot.x, bot.y, candidate, LOOKAHEAD_DISTANCE)) return candidate
      }
    }
    return bot.rotation + Math.PI // fully boxed in — same last-resort reversal pickClearHeading uses
  }

  botSpeed(runtime) {
    return BOT_SPEED * (SHIP_SPEED_MULT[runtime.shipType] ?? 1)
  }

  /**
   * Turn side-on to the target rather than bow-on — cannons are on the
   * broadsides, same rule the player's own fire uses. Derived from
   * handleFire's own broadside vectors, not guessed: solving
   * broadside_right(rotation) == unit vector toward the target gives
   * rotation = toTarget + π (bow pointing away — its right side, opposite
   * forward-rotated -90°, ends up facing the target); solving the same for
   * 'left' gives rotation = toTarget (bow pointing straight at it).
   *
   * Which side to present is recomputed every tick now, weighted toward
   * whichever cannon is actually off cooldown (mirrors the original's
   * Move_in_Battle checking _ready_shoot_right/_ready_shoot_left
   * independently — a bot with one side reloading should favor swinging
   * its *ready* side around, not sit there presenting a side that can't
   * fire). Combined with a much faster turn rate (see BOT_TURN_LERP), this
   * is what stops a player from just circling a bot that can't keep its
   * broadside on them.
   */
  broadsideStep(botId, bot, runtime, target, now, deltaMs) {
    const toTarget = Math.atan2(target.player.y - bot.y, target.player.x - bot.x)
    const rightBroadside = toTarget + Math.PI
    const leftBroadside = toTarget

    // Bots always sit at cannon level 0 (no upgrade to load), so their real
    // reload time is exactly RELOAD_BASE_MS, unmodified — same number
    // FIRE_COOLDOWN_MS used to be before reload became a per-player stat.
    const rightReady = now - (this.lastFiredAt.get(`${botId}:right`) ?? 0) >= RELOAD_BASE_MS
    const leftReady = now - (this.lastFiredAt.get(`${botId}:left`) ?? 0) >= RELOAD_BASE_MS

    let side
    if (rightReady && !leftReady) side = 'right'
    else if (leftReady && !rightReady) side = 'left'
    // Both (or neither) ready — whichever needs the smaller turn, so the
    // bot isn't spinning further than it has to.
    else side = Math.abs(angleDiff(bot.rotation, rightBroadside)) < Math.abs(angleDiff(bot.rotation, leftBroadside)) ? 'right' : 'left'

    const desired = side === 'right' ? rightBroadside : leftBroadside

    this.turnToward(bot, desired)
    // Hold position rather than closing further once side-on — original
    // Move_in_Battle circles at range rather than ramming.
    this.advance(bot, 0, deltaMs)

    if (Math.abs(angleDiff(bot.rotation, desired)) < 0.15) {
      this.handleFire(botId, side, now)
    }
  }

  turnToward(bot, desiredHeading) {
    bot.rotation += angleDiff(desiredHeading, bot.rotation) * BOT_TURN_LERP
  }

  // Returns whether the bot actually moved — false means blocked by the map
  // edge or an island, which callers use to react immediately (see
  // patrolStep) instead of only on the next scheduled heading change.
  advance(bot, speed, deltaMs) {
    if (speed === 0) return true
    const next = pointAhead(bot.x, bot.y, bot.rotation, speed * (deltaMs / 1000))

    if (this.isBlocked(next.x, next.y)) return false

    bot.x = next.x
    bot.y = next.y
    return true
  }

  // ---- combat (shared by human fire messages and bot AI) ----

  /**
   * Fires a cannonball that actually travels (see tickCannonballs) instead
   * of resolving instantly — a target that changes course during the flight
   * can genuinely dodge, same as the original C# game. The ball stops at
   * whatever it reaches first: the max range, an island's shore, or any
   * ship's hull other than the shooter's own — it doesn't care who that
   * ship is, so a third party sailing through the line of fire eats it too.
   */
  // client is only ever set for a real player's own 'fire' message (see the
  // onMessage handler above) — bots call this with no client to notify,
  // since they're not a real connection and there's nothing to tell.
  handleFire(attackerId, side, now = Date.now(), client = null) {
    const attacker = this.state.players.get(attackerId)
    if (!attacker) return
    // Bots already won't target a player standing in port territory (see
    // isNearAnyPort) — but nothing stopped that same player from opening
    // fire themselves, on a bot or another human. Applies to bots too, not
    // just humans: nobody gets to fire from inside the safe zone. Checked
    // before the cooldown below is even touched, so mashing fire while
    // docked doesn't burn a real shot's cooldown for nothing.
    //
    // The client already refuses to even send 'fire' while it knows it's
    // docked (see updateAiming/currentNearPortId in WorldPage.vue) — this
    // notifies anyway as a backstop for a stale or bypassed client, same
    // reasoning as startPvpAbordage's own in_port_zone rejection.
    if (this.isNearAnyPort(attacker.x, attacker.y)) {
      client?.send('fire_rejected', { reason: 'in_port_zone' })
      return
    }

    // Computed before the cooldown check now — reload is itself an
    // upgradeable stat (see broadsideCannons/RELOAD_LEVEL_BONUS_FRACTION),
    // so "is this side off cooldown yet" needs this side's own real reload
    // time, not the flat constant it used to be.
    const { cannons, cooldown } = this.broadsideCannons(attacker.shipType, attackerId, side, attacker.isBot)

    const cooldownKey = `${attackerId}:${side}`
    const lastFired = this.lastFiredAt.get(cooldownKey) ?? 0
    if (now - lastFired < cooldown) return
    this.lastFiredAt.set(cooldownKey, now)

    const fx = Math.sin(attacker.rotation)
    const fy = -Math.cos(attacker.rotation)
    const dir = side === 'right' ? { x: fy, y: -fx } : { x: -fy, y: fx }
    const baseAngle = Math.atan2(dir.y, dir.x)
    const count = cannons.length

    // Every cannon in the volley gets its own launch angle, fanned evenly
    // across the spread (not randomized — these are fixed gun positions
    // along the hull, they don't jitter shot to shot) and its own
    // damage/range/speed from its own upgrade level.
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5 // -0.5..0.5
      const angle = baseAngle + t * 2 * CANNON_SPREAD_HALF_ANGLE
      const cannon = cannons[i]
      this.cannonballs.push({
        attackerId, x: attacker.x, y: attacker.y,
        dx: Math.cos(angle), dy: Math.sin(angle), traveled: 0,
        damage: cannon.damage, range: cannon.range, speed: cannon.speed,
      })
    }

    // The client's blind visual tween (see spawnBroadsideVolley in
    // WorldPage.vue) reconstructs the same fan shape from just the count —
    // it doesn't need each individual cannon's exact numbers (that's not
    // what decides any real hit; 'hit' below carries the actual damage
    // dealt), just enough to look right: how many balls, how far, how fast.
    const range = Math.max(...cannons.map((c) => c.range))
    const speed = Math.round(cannons.reduce((sum, c) => sum + c.speed, 0) / count)
    this.broadcast('fired', { attackerId, side, count, range, speed })
  }

  /**
   * Per-cannon stats for one broadside (half the ship's cannons, split per
   * SHIP_CANNON_COUNT — first half of slots is 'left', second half
   * 'right', an arbitrary but consistent split, not tied to which UI
   * button a player actually calls "left"). Each entry is one gun's own
   * damage/range/speed at its own upgrade level — "качать каждую пушку
   * отдельно" means each one actually fires its own ball now, not just a
   * separately-tracked number folded into one aggregate shot. Cooldown is
   * still shared across the whole side (one crew reloading one battery),
   * based on the side's AVERAGE level. Uses the player's real upgrade
   * levels if known (see playerCannonLevels, loaded once on join) or a flat
   * level-0 for every slot otherwise — bots (no account to own an
   * upgrade), or a human whose levels haven't finished loading yet — same
   * numbers a stock, unupgraded hull of that type would have either way.
   */
  broadsideCannons(shipType, sessionId, side, isBot = false) {
    const totalCannons = SHIP_CANNON_COUNT[shipType] ?? SHIP_CANNON_COUNT.boat
    const perSide = Math.max(1, Math.floor(totalCannons / 2))
    const levels = this.playerCannonLevels.get(sessionId)
    const base = CANNON_BASE[shipType] ?? CANNON_BASE.boat
    const offset = side === 'right' ? perSide : 0
    // See BOT_DAMAGE_MULT's own comment — a bot's guns, not a bot's hull.
    const damageMult = isBot ? BOT_DAMAGE_MULT : 1

    const cannons = []
    let levelSum = 0
    for (let i = 0; i < perSide; i++) {
      const level = levels?.[offset + i] ?? 0
      const mult = 1 + CANNON_LEVEL_BONUS_FRACTION * level
      cannons.push({
        damage: Math.round(base.damage * mult * damageMult),
        range: Math.round(base.range * mult),
        speed: Math.round(base.speed * mult),
      })
      levelSum += level
    }
    // Reload uses the SIDE'S AVERAGE level, same reasoning speed used to —
    // deliberately not the fastest gun in the battery (that'd make one
    // upgraded cannon drag the whole broadside's cadence up) or the slowest.
    const avgLevel = levelSum / perSide
    const cooldown = Math.round(RELOAD_BASE_MS * (1 - RELOAD_LEVEL_BONUS_FRACTION * avgLevel))
    return { cannons, cooldown }
  }

  tickCannonballs(deltaMs) {
    if (this.cannonballs.length === 0) return
    const remaining = []

    for (const ball of this.cannonballs) {
      const step = ball.speed * (deltaMs / 1000)
      ball.x += ball.dx * step
      ball.y += ball.dy * step
      ball.traveled += step

      if (this.collidesWithIsland(ball.x, ball.y)) {
        this.broadcast('cannonball_blocked', { attackerId: ball.attackerId, x: ball.x, y: ball.y })
        continue // absorbed by the shore — no damage, ball removed
      }

      const hitTarget = this.findCannonballHit(ball)
      if (hitTarget) {
        this.resolveHit(ball.attackerId, hitTarget[0], hitTarget[1], ball.damage)
        continue
      }

      if (ball.traveled < ball.range) remaining.push(ball) // still flying — a clean miss once it runs out
    }

    this.cannonballs = remaining
  }

  findCannonballHit(ball) {
    for (const [targetId, target] of this.state.players) {
      if (targetId === ball.attackerId) continue
      // handleFire already blocks firing FROM inside the zone — this is the
      // other half: a ball fired from open water shouldn't be able to reach
      // someone who's since made it into port territory either. The ball
      // just keeps flying past them, same as it does past an island it
      // missed — not "blocked" with its own message, just a non-target.
      if (this.isNearAnyPort(target.x, target.y)) continue
      if (Math.hypot(target.x - ball.x, target.y - ball.y) <= CANNONBALL_HIT_RADIUS) return [targetId, target]
    }
    return null
  }

  resolveHit(attackerId, targetId, target, damage) {
    const attacker = this.state.players.get(attackerId)
    if (!attacker) return

    target.hp = Math.max(0, target.hp - damage)
    this.broadcast('hit', { attackerId, targetId, damage, hp: target.hp })

    if (target.isBot) {
      const targetRuntime = this.botRuntime.get(targetId)
      if (targetRuntime?.temperament === 'calm' && !targetRuntime.provokedBy) {
        targetRuntime.provokedBy = attackerId
        // Decided once, right when first provoked — not every tick, or a
        // borderline power ratio would flicker between fighting back and
        // running. Weighs every hostile human currently nearby, not just
        // this one attacker (see nearbyHostilePower's own comment).
        targetRuntime.fleeing = !this.shouldBotEngage(target, this.nearbyHostilePower(target))
      }
    }

    if (target.hp <= 0) {
      // Both branches below used to hand a reward straight to whoever's
      // credited as the attacker (instant bounty, a private loot_offer
      // route) — now it's a CargoDrop at the death spot instead, race-able
      // by anyone who gets there within CARGO_DROP_TTL_MS, attacker
      // included but not guaranteed. See spawnCargoDrop/tickCargoDrops.
      const deathX = target.x
      const deathY = target.y

      if (target.isBot) {
        this.broadcast('sunk', { targetId })
        // Every bot death drops something now, regardless of who (or what)
        // landed the killing blow — a bot killed by another bot used to
        // reward nobody at all, which is most bot deaths, most of the time.
        const tier = Math.max(0, SHIP_TYPES.indexOf(target.shipType))
        // Was instant (30-80)*(tier+1) straight to the attacker's account —
        // now it's what the crate carries, race-able by anyone, same as
        // the cargo. 5x base and width from the old instant version, since
        // getting there first now costs something an instant credit didn't.
        const gold = (Math.floor(Math.random() * 101) + 150) * (tier + 1)
        this.spawnCargoDrop(deathX, deathY, gold, this.generateBotCargo(tier))
        this.respawnBotLater(targetId)
      } else {
        // Sinking costs something real — 5-15% of gold, cargo, and crew
        // each, not "what's left" being that range (see DEATH_LOSS_MIN/MAX).
        // The lost gold/cargo (not the crew) becomes the drop.
        const survivalFraction = 1 - (DEATH_LOSS_MIN + Math.random() * (DEATH_LOSS_MAX - DEATH_LOSS_MIN))
        applyDeathPenalty(target.userId, survivalFraction)
          .then(({ lostGold, lostProducts }) => this.spawnCargoDrop(deathX, deathY, lostGold, lostProducts))
          .catch((e) => console.error('applyDeathPenalty failed', e))

        const port = this.ports[Math.floor(Math.random() * this.ports.length)]
        target.hp = Math.floor(target.maxHp * DEATH_RESPAWN_HP_FRACTION)
        target.x = port?.spawnX ?? SPAWN.x
        target.y = port?.spawnY ?? SPAWN.y

        this.broadcast('sunk', { targetId, respawnHp: target.hp, respawnX: target.x, respawnY: target.y })
      }
    }
  }

  /** Drops nothing if there's actually nothing to drop (a stripped-bare ship, or a bot cargo roll that happened to net zero). */
  spawnCargoDrop(x, y, gold, products) {
    const hasProducts = Object.values(products).some((qty) => qty > 0)
    if (gold <= 0 && !hasProducts) return

    const id = `drop-${this.cargoDropCounter++}`
    const drop = new CargoDrop()
    drop.x = x
    drop.y = y
    drop.gold = Math.max(0, gold)
    drop.goldClaimed = gold <= 0
    drop.spawnedAt = Date.now()
    drop.products = new MapSchema()
    for (const [type, qty] of Object.entries(products)) {
      if (qty > 0) drop.products.set(type, qty)
    }
    this.state.cargoDrops.set(id, drop)
  }

  /** TTL expiry + proximity-based pickup, one pass per simulation tick. */
  tickCargoDrops() {
    const now = Date.now()
    for (const [id, drop] of this.state.cargoDrops.entries()) {
      if (now - drop.spawnedAt > CARGO_DROP_TTL_MS) {
        this.state.cargoDrops.delete(id)
        continue
      }
      // Bots deliberately never pick these up — a bot has no real account
      // for gold to land in or a persisted hold for cargo to land in, and
      // letting them scoop drops before a human arrives would undercut the
      // entire point of this being a race.
      for (const [sessionId, player] of this.state.players.entries()) {
        if (player.isBot) continue
        if (Math.hypot(player.x - drop.x, player.y - drop.y) > CARGO_PICKUP_RANGE) continue
        this.claimCargoDrop(id, sessionId, player)
      }
    }
  }

  /**
   * Locked per-drop (see dropsBeingClaimed) for the duration of the async
   * DB round-trip — otherwise a second player detected in the same tick,
   * before this one's award/claim queries resolve, could be granted the
   * same still-full gold/products. Gold and products are still claimed
   * independently of each other: arriving after the gold's already gone
   * still gets a shot at whatever cargo remains, and vice versa.
   */
  claimCargoDrop(id, sessionId, player) {
    if (this.dropsBeingClaimed.has(id)) return
    const drop = this.state.cargoDrops.get(id)
    if (!drop) return

    const wantsGold = !drop.goldClaimed && drop.gold > 0
    const wanted = {}
    for (const [type, qty] of drop.products.entries()) {
      if (qty > 0) wanted[type] = qty
    }
    if (!wantsGold && Object.keys(wanted).length === 0) return

    this.dropsBeingClaimed.add(id)
    this.claimCargoDropAsync(id, sessionId, player, wantsGold ? drop.gold : 0, wanted)
      .catch((e) => console.error('claimCargoDrop failed', e))
      .finally(() => this.dropsBeingClaimed.delete(id))
  }

  async claimCargoDropAsync(id, sessionId, player, goldToClaim, wanted) {
    const claimedGold = goldToClaim
    if (claimedGold > 0) await awardBounty(player.userId, claimedGold)

    const takenProducts = Object.keys(wanted).length > 0 ? await claimCargoProducts(player.userId, wanted) : {}

    // Re-read — the drop could have fully expired (TTL) while the above
    // was in flight; nothing left to deplete or notify about either way.
    const drop = this.state.cargoDrops.get(id)
    if (!drop) return

    if (claimedGold > 0) {
      drop.gold = 0
      drop.goldClaimed = true
    }
    let anyTaken = claimedGold > 0
    for (const [type, takenQty] of Object.entries(takenProducts)) {
      if (takenQty <= 0) continue
      anyTaken = true
      const remaining = (drop.products.get(type) ?? 0) - takenQty
      if (remaining <= 0) drop.products.delete(type)
      else drop.products.set(type, remaining)
    }

    if (anyTaken) {
      this.clients.find((c) => c.sessionId === sessionId)?.send('cargo_claimed', { gold: claimedGold, products: takenProducts })
    }

    const productsLeft = [...drop.products.values()].some((qty) => qty > 0)
    if (drop.goldClaimed && !productsLeft) this.state.cargoDrops.delete(id)
  }
}
