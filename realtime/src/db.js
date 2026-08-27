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

export async function saveShip(userId, { x, y, hp }) {
  await pool.query('UPDATE ships SET x = $1, y = $2, hp = $3, updated_at = now() WHERE user_id = $4', [x, y, hp, userId])
}

export async function awardBounty(userId, amount) {
  await pool.query('UPDATE users SET coins = coins + $1 WHERE id = $2', [amount, userId])
}

// Sinking a human costs something real, same principle as bot loot (see
// generateBotCargo) — survivalFraction is what's LEFT, not what's lost (0.85
// to 0.95 for the requested 5-15% loss). Touches gold, cargo, and crew all
// at once; a sailorless or emptied-hold ship is a perfectly valid resulting
// state, not cleaned up specially.
// $1 needs an explicit ::float cast in every query below — without it,
// Postgres infers $1's type from the surrounding expression (coins * $1,
// an integer column) as integer too, then chokes trying to parse the
// actual 0.85-0.95 fraction as one ("invalid input syntax for type
// integer"). Silently failed every single time in production — no death
// penalty ever actually landed — until caught by reading the realtime
// container's own error logs after deploy.
//
// Returns what was actually lost (gold + per-product amounts) — the exact
// same numbers the UPDATE below computes, just read back before/after
// instead of trusted from a RETURNING clause across three separate tables
// — so the caller (see resolveHit/spawnCargoDrop in WorldRoom.js) can drop
// it as a floating crate instead of it just vanishing into the death
// penalty the way it used to.
export async function applyDeathPenalty(userId, survivalFraction) {
  const shipRow = await pool.query('SELECT id FROM ships WHERE user_id = $1', [userId])
  const shipId = shipRow.rows[0]?.id ?? null

  const before = await pool.query('SELECT coins FROM users WHERE id = $1', [userId])
  const productsBefore = shipId
    ? await pool.query('SELECT type, quantity FROM ship_products WHERE ship_id = $1', [shipId])
    : { rows: [] }

  await pool.query('UPDATE users SET coins = FLOOR(coins * $1::float) WHERE id = $2', [survivalFraction, userId])
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

  const coinsBefore = before.rows[0]?.coins ?? 0
  const lostGold = coinsBefore - Math.floor(coinsBefore * survivalFraction)
  const lostProducts = {}
  for (const row of productsBefore.rows) {
    const lost = row.quantity - Math.floor(row.quantity * survivalFraction)
    if (lost > 0) lostProducts[row.type] = lost
  }
  return { lostGold, lostProducts }
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
