import pg from 'pg'

const { Pool } = pg

// Same Postgres instance Laravel owns (see architecture DECK 01/04): this
// service reads/writes the `ships` table directly rather than going through
// a REST round-trip for every join/leave.
export const pool = new Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_DATABASE ?? 'corsaries',
  user: process.env.DB_USERNAME ?? 'corsaries',
  password: process.env.DB_PASSWORD ?? 'corsaries',
})

export async function loadShip(userId) {
  const { rows } = await pool.query('SELECT x, y, hp, type FROM ships WHERE user_id = $1', [userId])
  return rows[0] ?? null
}

// One entry per slot, ordered — GunsmithController::ensureCannonSlots (run
// on every shipyard purchase, Laravel-side) guarantees a contiguous
// 0..cannon_count-1 run for whatever the ship's CURRENT type is, so this is
// safe to index straight into by position. Read once per onJoin (see
// WorldRoom.js) — a player reaches this service fresh every time (leaving
// the world room to visit a port disconnects entirely, per the client's
// own onBeforeUnmount), so there's nothing to invalidate mid-session: a
// gunsmith purchase is already reflected the next time they actually join.
export async function loadShipCannonLevels(userId) {
  const { rows } = await pool.query(
    `SELECT sc.level FROM ship_cannons sc
     JOIN ships s ON s.id = sc.ship_id
     WHERE s.user_id = $1
     ORDER BY sc.slot`,
    [userId],
  )
  return rows.map((r) => r.level)
}

/** Оснастка's three ship-wide levels — see api/config/rigging.php and WorldRoom.js's SHIP_STATS_BASE for how these turn into an actual speed/protection/dodge boost. */
export async function loadShipRigging(userId) {
  const { rows } = await pool.query(
    `SELECT s.sails_level, s.hull_level, s.tackle_level FROM ships s WHERE s.user_id = $1`,
    [userId],
  )
  return rows[0] ?? { sails_level: 0, hull_level: 0, tackle_level: 0 }
}

export async function saveShip(userId, { x, y, hp }) {
  await pool.query('UPDATE ships SET x = $1, y = $2, hp = $3, updated_at = now() WHERE user_id = $4', [x, y, hp, userId])
}

export async function awardBounty(userId, amount) {
  await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [amount, userId])
}

// Keep in sync with api/config/ships.php's price column — the gold penalty
// below is a percentage of THIS (the current hull's own price), not of
// whatever's actually in the player's wallet. It used to be the latter (a
// straight percentage of current coins, same survivalFraction that still
// governs products/crew below) — but a progression-curve simulation (real
// config numbers, Monte Carlo over thousands of fights) showed that quietly
// capping how much gold a player could ever hold onto: a bot kill's reward
// is flat per tier, but a percentage-of-holdings loss grows right along
// with a stockpile, so the two converge and progress stalls well short of
// the next hull's price. A flat cut tied to the ship itself doesn't have
// that problem — it stays gentle (3%) and scales with what actually
// changed (a bigger, more expensive ship), not with unrelated savings.
const SHIP_PRICE = {
  boat: 5000, schooner: 10000, caravel: 15000, brig: 25000,
  frigate: 40000, galleon: 65000, corvette: 100000, battleship: 200000,
}
const DEATH_GOLD_PENALTY_FRACTION = 0.03

// Sinking a human costs something real, same principle as bot loot (see
// generateBotCargo). Gold uses the flat, tier-based cut described above;
// cargo and crew still use survivalFraction (what's LEFT, not what's lost —
// 0.85 to 0.95 for the original 5-15% loss) — those aren't hoarded
// unboundedly the way gold is (cargo's capped by hold space, crew by
// max_sailors), so the same stalling problem never applied to them.
// $1 needs an explicit ::float cast in the product/sailor queries below —
// without it, Postgres infers $1's type from the surrounding expression
// (quantity * $1, an integer column) as integer too, then chokes trying to
// parse the actual 0.85-0.95 fraction as one ("invalid input syntax for
// type integer"). Silently failed every single time in production — no
// penalty ever actually landed — until caught by reading the realtime
// container's own error logs after deploy.
//
// Returns what was actually lost (gold + per-product amounts + total crew)
// — the exact same numbers the UPDATEs below compute, just read back
// before/after instead of trusted from a RETURNING clause across three
// separate tables — so the caller (see resolveHit/spawnCargoDrop in
// WorldRoom.js) can drop the gold/cargo as a floating crate and tell the
// victim what actually happened, instead of it just silently vanishing
// into the death penalty the way it used to.
export async function applyDeathPenalty(userId, survivalFraction) {
  const shipRow = await pool.query('SELECT id, type FROM ships WHERE user_id = $1', [userId])
  const shipId = shipRow.rows[0]?.id ?? null
  const shipType = shipRow.rows[0]?.type ?? 'boat'

  const before = await pool.query('SELECT coins FROM users WHERE id = $1', [userId])
  const productsBefore = shipId
    ? await pool.query('SELECT type, quantity FROM ship_products WHERE ship_id = $1', [shipId])
    : { rows: [] }
  const sailorsBefore = shipId
    ? await pool.query('SELECT COALESCE(SUM(count), 0) AS total FROM ship_sailors WHERE ship_id = $1', [shipId])
    : { rows: [{ total: 0 }] }

  const coinsBefore = before.rows[0]?.coins ?? 0
  const goldPenalty = Math.min(coinsBefore, Math.round((SHIP_PRICE[shipType] ?? SHIP_PRICE.boat) * DEATH_GOLD_PENALTY_FRACTION))
  await pool.query('UPDATE users SET coins = coins - $1 WHERE id = $2', [goldPenalty, userId])

  await pool.query(
    `UPDATE ship_products SET quantity = GREATEST(0, FLOOR(quantity * $1::float))
     WHERE ship_id = (SELECT id FROM ships WHERE user_id = $2)`,
    [survivalFraction, userId],
  )
  await pool.query(
    `UPDATE ship_sailors SET count = GREATEST(0, FLOOR(count * $1::float))
     WHERE ship_id = (SELECT id FROM ships WHERE user_id = $2)`,
    [survivalFraction, userId],
  )

  const lostGold = goldPenalty
  const lostProducts = {}
  for (const row of productsBefore.rows) {
    const lost = row.quantity - Math.floor(row.quantity * survivalFraction)
    if (lost > 0) lostProducts[row.type] = lost
  }
  const sailorsTotal = Number(sailorsBefore.rows[0]?.total ?? 0)
  const lostSailors = sailorsTotal - Math.floor(sailorsTotal * survivalFraction)
  return { lostGold, lostProducts, lostSailors }
}

// Keep in sync with api/config/products.php's weight column and
// api/config/ships.php's capacity column — this and Laravel's own
// capacity check (PortController::trade) are the only two places cargo
// weight actually gets enforced, and they need to agree.
const PRODUCT_WEIGHT = { rum: 1, silk: 2, water: 1, food: 1, leather: 10, wood: 20, tobacco: 3, coffee: 7 }
const SHIP_CAPACITY = {
  boat: 350, schooner: 650, caravel: 800, brig: 950,
  frigate: 1250, galleon: 1550, corvette: 1250, battleship: 2200,
}

// Fills up to whatever's left of the ship's own hold, product by product in
// whatever order `wanted` iterates — a crate bigger than one hold is
// deliberately meant to be splittable across several claimers (or the same
// one coming back), not an all-or-nothing grab. Returns what actually got
// taken so the caller can deplete the shared CargoDrop by exactly that
// (see claimCargoDrop in WorldRoom.js) — never more than `wanted` offered,
// regardless of how much room was free.
export async function claimCargoProducts(userId, wanted) {
  const shipRow = await pool.query('SELECT id, type FROM ships WHERE user_id = $1', [userId])
  const ship = shipRow.rows[0]
  if (!ship) return {}

  const owned = await pool.query('SELECT type, quantity FROM ship_products WHERE ship_id = $1', [ship.id])
  let usedWeight = owned.rows.reduce((sum, row) => sum + row.quantity * (PRODUCT_WEIGHT[row.type] ?? 0), 0)
  const capacity = SHIP_CAPACITY[ship.type] ?? 0

  const taken = {}
  for (const [type, qty] of Object.entries(wanted)) {
    const weight = PRODUCT_WEIGHT[type] ?? 0
    const freeSpace = capacity - usedWeight
    const fits = weight > 0 ? Math.min(qty, Math.floor(freeSpace / weight)) : qty
    if (fits <= 0) continue

    await pool.query(
      `INSERT INTO ship_products (ship_id, type, quantity, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (ship_id, type) DO UPDATE SET quantity = ship_products.quantity + $3, updated_at = now()`,
      [ship.id, type, fits],
    )
    taken[type] = fits
    usedWeight += fits * weight
  }
  return taken
}

// items: { productType: quantity }. Laravel owns claiming/capacity checks
// (see LootController) — this just records what's available to claim.
// Still used by abordage victories (a separate flow from naval-kill
// CargoDrops — see AbordagePve/PvpService), not by resolveHit anymore.
export async function createLootOffer(userId, items) {
  const { rows } = await pool.query(
    `INSERT INTO loot_offers (user_id, items, status, expires_at, created_at, updated_at)
     VALUES ($1, $2, 'pending', now() + interval '5 minutes', now(), now())
     RETURNING id`,
    [userId, JSON.stringify(items)],
  )
  return rows[0].id
}
