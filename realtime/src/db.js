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
export async function applyDeathPenalty(userId, survivalFraction) {
  await pool.query('UPDATE users SET coins = FLOOR(coins * $1) WHERE id = $2', [survivalFraction, userId])
  await pool.query(
    `UPDATE ship_products SET quantity = GREATEST(0, FLOOR(quantity * $1))
     WHERE ship_id = (SELECT id FROM ships WHERE user_id = $2)`,
    [survivalFraction, userId],
  )
  await pool.query(
    `UPDATE ship_sailors SET count = GREATEST(0, FLOOR(count * $1))
     WHERE ship_id = (SELECT id FROM ships WHERE user_id = $2)`,
    [survivalFraction, userId],
  )
}

// items: { productType: quantity }. Laravel owns claiming/capacity checks
// (see LootController) — this just records what's available to claim.
export async function createLootOffer(userId, items) {
  const { rows } = await pool.query(
    `INSERT INTO loot_offers (user_id, items, status, expires_at, created_at, updated_at)
     VALUES ($1, $2, 'pending', now() + interval '5 minutes', now(), now())
     RETURNING id`,
    [userId, JSON.stringify(items)],
  )
  return rows[0].id
}
