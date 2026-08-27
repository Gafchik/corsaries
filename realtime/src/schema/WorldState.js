import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema'

// Plain-JS schema definition (no TS decorators) — see Colyseus docs.
export class Player extends Schema {}
defineTypes(Player, {
  x: 'number',
  y: 'number',
  rotation: 'number',
  hp: 'number',
  maxHp: 'number',
  firstName: 'string',
  isBot: 'boolean',
  shipType: 'string',
  // Only meaningful for bots ('aggressive'/'calm') — empty for humans. Lets
  // clients color-code hostility without parsing it back out of firstName.
  temperament: 'string',
})

// Procedurally generated once at room creation (see worldgen.js) and synced
// like any other state — clients get the real coastline for free on join,
// no separate fetch or duplicated noise math needed.
export class Island extends Schema {}
defineTypes(Island, {
  x: 'number',
  y: 'number',
  baseRadius: 'number',
  points: ['number'], // shore radius sampled around the circle — see genShore
})

// A sunk ship's gold + cargo, floating in the world instead of an instant
// private reward — see resolveHit/spawnCargoDrop in WorldRoom.js. Gold is
// claimed whole by whoever reaches it first; products drain by whatever
// fits each claimer's own remaining cargo space, so a drop bigger than one
// hold can be split between several players (or the same one, twice).
export class CargoDrop extends Schema {}
defineTypes(CargoDrop, {
  x: 'number',
  y: 'number',
  gold: 'number',
  goldClaimed: 'boolean',
  products: { map: 'number' }, // productType -> quantity still unclaimed
  spawnedAt: 'number', // Date.now() ms — client derives the radial timer from this, not a synced countdown
})

export class WorldState extends Schema {}
defineTypes(WorldState, {
  players: { map: Player },
  islands: [Island],
  cargoDrops: { map: CargoDrop },
})

export function createWorldState() {
  const state = new WorldState()
  state.players = new MapSchema()
  state.islands = new ArraySchema()
  state.cargoDrops = new MapSchema()
  return state
}
