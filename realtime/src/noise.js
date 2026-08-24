// A small, self-contained, seeded 2D simplex noise — no dependency needed
// for what's really just "smooth pseudo-random field over a plane". Seeded
// so island layout is reproducible across server restarts (a random seed
// would reshuffle the coastline under players' already-saved positions).

// mulberry32: tiny deterministic PRNG, good enough to build a permutation
// table from — this isn't cryptography, just needs to be repeatable.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const GRAD_2D = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
]

export class SimplexNoise2D {
  constructor(seed) {
    const rand = mulberry32(seed)
    const perm = Array.from({ length: 256 }, (_, i) => i)
    // Fisher-Yates using the seeded PRNG, so the permutation — and every
    // noise value derived from it — is fully determined by `seed`.
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[perm[i], perm[j]] = [perm[j], perm[i]]
    }
    this.perm = new Uint8Array(512)
    for (let i = 0; i < 512; i++) this.perm[i] = perm[i & 255]
  }

  grad(i, x, y) {
    const g = GRAD_2D[this.perm[i & 255] & 7]
    return g[0] * x + g[1] * y
  }

  // Standard 2D simplex noise, returns roughly [-1, 1].
  noise(xin, yin) {
    const F2 = 0.5 * (Math.sqrt(3) - 1)
    const G2 = (3 - Math.sqrt(3)) / 6

    const s = (xin + yin) * F2
    const i = Math.floor(xin + s)
    const j = Math.floor(yin + s)
    const t = (i + j) * G2
    const X0 = i - t
    const Y0 = j - t
    const x0 = xin - X0
    const y0 = yin - Y0

    const [i1, j1] = x0 > y0 ? [1, 0] : [0, 1]

    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2

    const ii = i & 255
    const jj = j & 255

    let n0 = 0
    let t0 = 0.5 - x0 * x0 - y0 * y0
    if (t0 > 0) {
      t0 *= t0
      n0 = t0 * t0 * this.grad(this.perm[ii + this.perm[jj]], x0, y0)
    }

    let n1 = 0
    let t1 = 0.5 - x1 * x1 - y1 * y1
    if (t1 > 0) {
      t1 *= t1
      n1 = t1 * t1 * this.grad(this.perm[ii + i1 + this.perm[jj + j1]], x1, y1)
    }

    let n2 = 0
    let t2 = 0.5 - x2 * x2 - y2 * y2
    if (t2 > 0) {
      t2 *= t2
      n2 = t2 * t2 * this.grad(this.perm[ii + 1 + this.perm[jj + 1]], x2, y2)
    }

    return 70 * (n0 + n1 + n2)
  }
}
