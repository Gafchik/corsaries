import { SimplexNoise2D } from './noise.js'

// Fixed on purpose — a random seed would reshuffle the coastline on every
// server restart, and saved ship positions (real x/y in Postgres) don't
// move with it. Bump this only if you want a deliberately new map.
const WORLD_SEED = 1337

const DENSITY_SCALE = 0.00035 // lower = broader, slower-changing archipelago clusters
const SHORE_SCALE = 3.2 // how many wobbles around a single island's coastline
const CLUSTER_CANDIDATES = 600 // grid samples scored for cluster placement
const CLUSTER_COUNT = 10 // was 6 — felt sparse on a 4800x4800 map, more clusters fill it out
const MIN_CLUSTER_SPACING = 900 // bigger islands below need more room between clusters
const ISLANDS_PER_CLUSTER = [2, 4] // inclusive range
const CLUSTER_SPREAD = 220 // how far an island can land from its cluster center
const BASE_RADIUS_RANGE = [110, 200] // was [50, 95] — read as too small next to ship/map scale
const SHORE_POINT_COUNT = 16 // boundary samples per island — smooth enough, cheap enough
const SHORE_VARIANCE = 0.35 // how wobbly the coastline is, as a fraction of baseRadius

/**
 * Two noise fields doing two different jobs: `density` decides *where*
 * archipelagos cluster (broad, slow-changing — real island chains aren't
 * uniformly scattered), `shore` decides each individual island's wobbly
 * coastline (tight, fast-changing, sampled going around the circle so it
 * seams closed with no visible joint — see genShore).
 */
export function generateIslands(mapSize) {
  const density = new SimplexNoise2D(WORLD_SEED)
  const shore = new SimplexNoise2D(WORLD_SEED + 1)
  const rand = mulberry32Like(WORLD_SEED + 2)

  const clusterCenters = pickClusterCenters(density, mapSize, rand)
  const islands = []

  for (const center of clusterCenters) {
    const count = randInt(rand, ISLANDS_PER_CLUSTER[0], ISLANDS_PER_CLUSTER[1])
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2
      const dist = rand() * CLUSTER_SPREAD
      const x = clamp(center.x + Math.cos(angle) * dist, 150, mapSize - 150)
      const y = clamp(center.y + Math.sin(angle) * dist, 150, mapSize - 150)
      const baseRadius = BASE_RADIUS_RANGE[0] + rand() * (BASE_RADIUS_RANGE[1] - BASE_RADIUS_RANGE[0])

      islands.push({ x, y, baseRadius, points: genShore(shore, x, y, baseRadius) })
    }
  }

  return islands
}

function genShore(shore, x, y, baseRadius) {
  const points = []
  for (let i = 0; i < SHORE_POINT_COUNT; i++) {
    const angle = (i / SHORE_POINT_COUNT) * Math.PI * 2
    // Sampling noise along a circle in noise-space (not along the angle
    // index) is what makes the shape wrap seamlessly — point 0 and the
    // last point are neighbors in noise-space too, not just in the array.
    const nx = x * 0.01 + Math.cos(angle) * SHORE_SCALE
    const ny = y * 0.01 + Math.sin(angle) * SHORE_SCALE
    const n = shore.noise(nx, ny) // roughly [-1, 1]
    points.push(baseRadius * (1 + n * SHORE_VARIANCE))
  }
  return points
}

function pickClusterCenters(density, mapSize, rand) {
  const candidates = []
  for (let i = 0; i < CLUSTER_CANDIDATES; i++) {
    const x = 200 + rand() * (mapSize - 400)
    const y = 200 + rand() * (mapSize - 400)
    const score = density.noise(x * DENSITY_SCALE, y * DENSITY_SCALE)
    candidates.push({ x, y, score })
  }
  candidates.sort((a, b) => b.score - a.score)

  const chosen = []
  for (const c of candidates) {
    if (chosen.length >= CLUSTER_COUNT) break
    if (chosen.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= MIN_CLUSTER_SPACING)) {
      chosen.push(c)
    }
  }
  return chosen
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}

function randInt(rand, min, max) {
  return min + Math.floor(rand() * (max - min + 1))
}

// Separate tiny PRNG (not the noise permutation one) just for placement
// randomness — same mulberry32 shape, kept local so worldgen.js has no
// runtime dependency beyond the noise module.
function mulberry32Like(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
