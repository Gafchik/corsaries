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

export class WorldState extends Schema {}
defineTypes(WorldState, {
  players: { map: Player },
  islands: [Island],
})

export function createWorldState() {
  const state = new WorldState()
  state.players = new MapSchema()
  state.islands = new ArraySchema()
  return state
}
