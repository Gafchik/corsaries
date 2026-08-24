import { Room } from '@colyseus/core'
import { ArraySchema } from '@colyseus/schema'
import { Player, Island, createWorldState } from '../schema/WorldState.js'
import { loadShip, saveShip, awardBounty, createLootOffer, applyDeathPenalty } from '../db.js'
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
const AUTOSAVE_INTERVAL_MS = 10000

// Mirrors config/products.php's keys — bots don't have a real persisted
// cargo hold, so this is what a merchant of that size is assumed to be
// carrying, rolled fresh at the moment it goes down.
const PRODUCT_TYPES = ['rum', 'silk', 'water', 'food', 'leather', 'wood', 'tobacco', 'coffee']
// "Sinking" isn't "vanishing" — most of the hold floats or beaches nearby.
// This is how much of it is lost, not how much survives (see DECK notes).
const LOOT_LOSS_MIN = 0.15
const LOOT_LOSS_MAX = 0.35

// A human sinking loses a slice of gold/cargo/crew and respawns at a random
// port, not full-HP at the map center — same "sinking costs something real"
// principle as bot loot, now pointed back at the player.
const DEATH_LOSS_MIN = 0.05
const DEATH_LOSS_MAX = 0.15
const DEATH_RESPAWN_HP_FRACTION = 0.5

// A shlyupka fresh out of spawn shouldn't run into a Battleship — the
// original's actual bug (see architecture DECK 08). Tier N only becomes
// possible once a bot is spawning at least N * TIER_DISTANCE_STEP away from
// the map center; within any allowed range, weighting still favors the
// weaker end so strong ships stay rare, not "as common as weak ones."
const TIER_DISTANCE_STEP = 440

// Keep in sync with MAP_SIZE in web/src/pages/WorldPage.vue until these two
// packages share a constants module. Islands themselves are no longer
// hand-placed here — see generateIslands()/onCreate(), synced to clients via
// state.islands.
const MAP_SIZE = 4800
const SPAWN = { x: 2400, y: 2400 }
// Must match SHORE_POINT_COUNT in worldgen.js — that's how many boundary
// samples each island's `points` array has, evenly spaced around the circle.
const SHORE_POINT_COUNT = 16

const CANNON_RANGE = 260
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
// A cannonball is now a real object that travels and can miss — see
// tickCannonballs(). Speed must match CANNONBALL_SPEED in WorldPage.vue: the
// client's own blind visual tween and the server's actual hit-resolution
// window need to take the same time to cross the same distance, or a "miss"
// would visually look like it should've hit (or vice versa).
const CANNONBALL_SPEED = 600
const CANNONBALL_HIT_RADIUS = 26
// Damage scales off the SHOOTER's own max HP, not a flat number or cannon
// count — cannon_count (config/ships.php) grows slower than max_hp as ships
// get bigger (a boat has 125 HP per cannon, a battleship 833), so scaling
// damage off cannon_count alone made every hull's broadside deal roughly
// the same *fraction of a same-tier target's HP*, tier be damned: a boat's
// four little guns and a galleon's twelve heavy ones both took ~15-17 hits
// to sink a same-tier opponent, and a galleon needed 17 hits to sink a BOAT
// — no real ship-of-the-line vs. rowboat gap at all. Tying damage to the
// shooter's own max HP instead fixes both at once: any same-tier fight
// takes about 1/DAMAGE_FRACTION_OF_OWN_HP hits regardless of tier (bigger
// guns, but a proportionally tankier target), while a real tier gap (a
// galleon's 6500 HP hull vs. a boat's 500) closes in a single hit, the way
// a ship of the line actually would.
const DAMAGE_FRACTION_OF_OWN_HP = 1 / 6
const FIRE_COOLDOWN_MS = 900

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
const BOT_AGGRO_RANGE = 320 // was 500 — noticing a ship from nearly across the screen read as bots having eyes everywhere
const BOT_ENGAGE_RANGE = 220 // inside CANNON_RANGE so a 90°-turned broadside still connects
const BOT_ENGAGE_EXIT_RANGE = 280 // hysteresis: leaving broadside mode needs a wider gap than entering it
// With 100 bots on the map, a relay of different aggressive ones drifting
// in and out of range read as one endless, un-losable chase — a bot now
// gives up after a bounded chase, same as the original's AI not being
// infinitely persistent, and won't re-engage anyone for a cooldown after.
const BOT_MAX_CHASE_MS = 15000
const BOT_GIVE_UP_COOLDOWN_MS = 6000
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
    this.botRuntime = new Map() // botId -> { mode, headingChangedAt }
    this.botCounter = 0
    this.cannonballs = [] // in-flight balls — see tickCannonballs()

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
      this.handleFire(client.sessionId, side)
    })

    this.onMessage('abordage_challenge', (client, { targetSessionId }) => {
      this.startPvpAbordage(client, targetSessionId).catch((e) => console.error('abordage_challenge failed', e))
    })

    for (let i = 0; i < TARGET_BOT_COUNT; i++) this.spawnBot()
    this.setSimulationInterval((deltaMs) => {
      this.tickBots(deltaMs)
      this.tickCannonballs(deltaMs)
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
  }

  async onLeave(client) {
    const player = this.state.players.get(client.sessionId)
    this.state.players.delete(client.sessionId)
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
    if (this.isNearAnyPort(challenger.x, challenger.y) || this.isNearAnyPort(target.x, target.y)) return

    const distance = Math.hypot(target.x - challenger.x, target.y - challenger.y)
    if (distance > ABORDAGE_RANGE) return

    const result = await laravelPost('/abordage/pvp', challenger.authToken, { opponent_user_id: target.userId })
    if (!result?.abordage) return

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

    const shipType = this.pickBotShipType(x, y)
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

    this.botRuntime.set(id, { mode: 'patrol', headingChangedAt: Date.now(), shipType, temperament, provokedBy: null })
  }

  respawnBotLater(botId) {
    this.state.players.delete(botId)
    this.botRuntime.delete(botId)
    this.clock.setTimeout(() => this.spawnBot(), BOT_RESPAWN_DELAY_MS)
  }

  /**
   * Weighted by distance from the map center: the tier ceiling only rises
   * with distance, and even once a strong tier is unlocked, the weighting
   * still favors the weaker end of the allowed range (weight ~ 1/(tier+1))
   * so, say, Frigates stay rare rather than as common as Boats the moment
   * they're merely possible.
   */
  pickBotShipType(x, y) {
    const distance = Math.hypot(x - SPAWN.x, y - SPAWN.y)
    const maxTier = Math.min(SHIP_TYPES.length - 1, Math.floor(distance / TIER_DISTANCE_STEP))

    const weights = []
    for (let tier = 0; tier <= maxTier; tier++) weights.push(1 / (tier + 1))
    const total = weights.reduce((a, b) => a + b, 0)

    let roll = Math.random() * total
    for (let tier = 0; tier <= maxTier; tier++) {
      roll -= weights[tier]
      if (roll <= 0) return SHIP_TYPES[tier]
    }
    return SHIP_TYPES[0]
  }

  /**
   * A bot has no persisted hold — this is what a merchant of that tier is
   * assumed to be carrying, rolled at the moment it sinks. 2-4 of the 8
   * product types, quantity scaled by tier, then reduced by whatever the
   * sinking cost (LOOT_LOSS_MIN..MAX lost, not survived — see the constant
   * comment) before it's ever offered.
   */
  generateBotCargo(tier) {
    const shuffled = [...PRODUCT_TYPES].sort(() => Math.random() - 0.5)
    const productCount = 2 + Math.floor(Math.random() * 3)
    const lossFraction = LOOT_LOSS_MIN + Math.random() * (LOOT_LOSS_MAX - LOOT_LOSS_MIN)
    const survivalFraction = 1 - lossFraction

    const items = {}
    for (const type of shuffled.slice(0, productCount)) {
      const fullAmount = (5 + Math.floor(Math.random() * 16)) * (tier + 1)
      const survived = Math.round(fullAmount * survivalFraction)
      if (survived > 0) items[type] = survived
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
   * Aggressive bots go after whoever's nearest. Calm ones ignore everyone
   * until provoked, then only ever chase that specific attacker — they
   * don't switch targets just because someone else got closer, and they
   * naturally stop caring once that attacker leaves aggro range (no
   * separate "forgive" timer needed, the existing range check covers it).
   */
  pickBotTarget(bot, runtime) {
    if (runtime.temperament === 'aggressive') return this.nearestHumanTarget(bot)

    if (!runtime.provokedBy) return null
    const attacker = this.state.players.get(runtime.provokedBy)
    if (!attacker || this.isNearAnyPort(attacker.x, attacker.y)) {
      runtime.provokedBy = null
      return null
    }
    return { id: runtime.provokedBy, player: attacker, dist: Math.hypot(attacker.x - bot.x, attacker.y - bot.y) }
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

      // Hysteresis: leaving broadside range needs to clear a wider band than
      // entering it did, or a target sitting right on the boundary flips the
      // bot between "approach" and "broadside" — two very different headings
      // — every single tick, which is exactly the zig-zag that got reported.
      const exitRange = runtime.mode === 'broadside' ? BOT_ENGAGE_EXIT_RANGE : BOT_ENGAGE_RANGE

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
    const ahead = pointAhead(bot.x, bot.y, bot.rotation, LOOKAHEAD_DISTANCE)
    const courseBlocked = this.isBlocked(ahead.x, ahead.y)

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
   * Samples random headings and keeps the first one whose lookahead point is
   * clear, rather than a single random guess that's just as likely to point
   * straight back at the same wall or island. Falls back to reversing
   * course if nothing clear turns up — rare (would need to be boxed in on
   * most sides), and wherever the bot just came from is usually safe.
   */
  pickClearHeading(bot) {
    for (let i = 0; i < LOOKAHEAD_TRIES; i++) {
      const candidate = Math.random() * Math.PI * 2
      const ahead = pointAhead(bot.x, bot.y, candidate, LOOKAHEAD_DISTANCE)
      if (!this.isBlocked(ahead.x, ahead.y)) return candidate
    }
    return bot.rotation + Math.PI
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

    const rightReady = now - (this.lastFiredAt.get(`${botId}:right`) ?? 0) >= FIRE_COOLDOWN_MS
    const leftReady = now - (this.lastFiredAt.get(`${botId}:left`) ?? 0) >= FIRE_COOLDOWN_MS

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
  handleFire(attackerId, side, now = Date.now()) {
    const attacker = this.state.players.get(attackerId)
    if (!attacker) return
    // Bots already won't target a player standing in port territory (see
    // isNearAnyPort) — but nothing stopped that same player from opening
    // fire themselves, on a bot or another human. Applies to bots too, not
    // just humans: nobody gets to fire from inside the safe zone. Checked
    // before the cooldown below is even touched, so mashing fire while
    // docked doesn't burn a real shot's cooldown for nothing.
    if (this.isNearAnyPort(attacker.x, attacker.y)) return

    const cooldownKey = `${attackerId}:${side}`
    const lastFired = this.lastFiredAt.get(cooldownKey) ?? 0
    if (now - lastFired < FIRE_COOLDOWN_MS) return
    this.lastFiredAt.set(cooldownKey, now)

    const fx = Math.sin(attacker.rotation)
    const fy = -Math.cos(attacker.rotation)
    const dir = side === 'right' ? { x: fy, y: -fx } : { x: -fy, y: fx }
    const damage = Math.round((SHIP_MAX_HP[attacker.shipType] ?? SHIP_MAX_HP.boat) * DAMAGE_FRACTION_OF_OWN_HP)

    this.broadcast('fired', { attackerId, side })

    this.cannonballs.push({ attackerId, x: attacker.x, y: attacker.y, dx: dir.x, dy: dir.y, traveled: 0, damage })
  }

  tickCannonballs(deltaMs) {
    if (this.cannonballs.length === 0) return
    const step = CANNONBALL_SPEED * (deltaMs / 1000)
    const remaining = []

    for (const ball of this.cannonballs) {
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

      if (ball.traveled < CANNON_RANGE) remaining.push(ball) // still flying — a clean miss once it runs out
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
      }
    }

    if (target.hp <= 0) {
      if (target.isBot) {
        this.broadcast('sunk', { targetId })
        // Naval combat was otherwise a pure cost (cannonballs are free,
        // but sinking a bot bought nothing) — same reasoning as abordage
        // loot: winning a fight should be the actual income, not a
        // random-walk market that's a coin flip either way.
        if (!attacker.isBot) {
          const tier = SHIP_TYPES.indexOf(target.shipType)
          const bounty = (Math.floor(Math.random() * 51) + 30) * (Math.max(0, tier) + 1)
          awardBounty(attacker.userId, bounty).catch((e) => console.error('awardBounty failed', e))
          this.broadcast('bounty', { attackerId, targetId, amount: bounty })

          const items = this.generateBotCargo(Math.max(0, tier))
          if (Object.keys(items).length > 0) {
            createLootOffer(attacker.userId, items)
              .then((offerId) => this.broadcast('loot_available', { attackerId, offerId }))
              .catch((e) => console.error('createLootOffer failed', e))
          }
        }
        this.respawnBotLater(targetId)
      } else {
        // Sinking costs something real — same "survival fraction" framing
        // as bot loot (see generateBotCargo/LOOT_LOSS_MIN/MAX): 5-15% of
        // gold, cargo, and crew each, not "what's left" being that range.
        const survivalFraction = 1 - (DEATH_LOSS_MIN + Math.random() * (DEATH_LOSS_MAX - DEATH_LOSS_MIN))
        applyDeathPenalty(target.userId, survivalFraction).catch((e) => console.error('applyDeathPenalty failed', e))

        const port = this.ports[Math.floor(Math.random() * this.ports.length)]
        target.hp = Math.floor(target.maxHp * DEATH_RESPAWN_HP_FRACTION)
        target.x = port?.spawnX ?? SPAWN.x
        target.y = port?.spawnY ?? SPAWN.y

        this.broadcast('sunk', { targetId, respawnHp: target.hp, respawnX: target.x, respawnY: target.y })
      }
    }
  }
}
