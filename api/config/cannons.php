<?php

// Per-cannon upgrade balance (see ShipCannon/GunsmithController) — a
// deliberately separate progression axis from ship type (config/ships.php):
// the hull decides how many cannons you have, this decides how good each
// one individually is.
//
// Calibration goal (explicit request): a fully-maxed cannon on tier N
// should land just short of a fresh, unupgraded cannon on tier N+1 — so
// mastering your current ship's guns is real progress, but never a
// substitute for the next hull up. With LEVELS=5 and a flat
// LEVEL_BONUS_FRACTION=10% of that tier's own base per level, tier N's
// max (base × 1.5) sits just under tier N+1's level-1 (base × growth ×
// 1.1) when growth ≈ 1.36 — that's what damage/range below are built from,
// tier over tier.
//
// speed is deliberately NOT on that same ×1.36 curve — it was, briefly,
// and a Galleon's ball crossed its own 1227-range in ~0.4s, indistinguishable
// from a pistol shot despite being the heaviest thing afloat (direct
// feedback). A real cannon's muzzle velocity doesn't scale with the ship
// carrying it; a slow, weighty ball reads as "heavy hull, big gun" far
// better than a fast one does. Speed is instead a per-ship-identity choice:
// mostly flat and gently rising, except Corvette (explicitly the fast,
// glass-cannon speedster — its whole hull stat block already says so) and
// Battleship, which gets a slow, ponderous shot on purpose — you can see
// it coming from far off, and that's the point.
// Reload is a fourth stat, but deliberately NOT built like the other
// three: it doesn't vary by ship tier at all (every hull's stock reload is
// the same reload_base_ms), and the per-level improvement is a small flat
// fraction, not the 10%-of-base the others use. Damage/range already scale
// hard with tier, and a bit less HARD with speed now too (see above) — if
// reload sped up the same way on top of that, a fully-upgraded Battleship
// would fire like a machine gun instead of the slow, deliberate broadside
// it's supposed to be. Capped at 5 levels × 2% = 10% faster, max — a real
// but modest edge, the same tiny percentage on a Boat as on a Battleship.
return [
    'levels' => 5,
    'level_bonus_fraction' => 0.10,
    'reload_base_ms' => 900,
    'reload_level_bonus_fraction' => 0.02,
    // Cost to go from level (L-1) to L, per cannon, 1-indexed by target
    // level — the shared curve SHAPE every hull scales by cost_multiplier
    // below (see Ship::cannonUpgradeCost). Growth between levels flattened
    // from the original 500/1500/4000/10000/25000 (a steady ~2.6× per
    // level, meaning the last two levels alone ate well over half the
    // total cost to max ANY hull's cannons, Шлюпка or Линкор alike — direct
    // feedback that levels 4-5 specifically felt disproportionately
    // expensive) down to a gentler ~1.9× per level. L1 stays the same 500
    // it always was — the early, casual upgrades weren't the complaint,
    // only the ones at the top.
    'level_cost' => [500, 1200, 2500, 4500, 7500],

    // A flat cost applied the same regardless of hull used to mean maxing
    // every gun on a Шлюпка cost ~246,000 (6 cannons × the old curve's
    // 41,000-per-cannon total) against a 5,000 ship price — a ~49× multiple
    // of the hull's OWN price, versus the Линкор's own ~6× (1,230,000
    // against 200,000). Nowhere close to worth it: a fully maxed Шлюпка
    // cannon (base 15 × 1.5) still does less damage than a stock Линкор's
    // (base 94), for triple the raw gold a whole new Линкор costs (direct
    // feedback: "проще купить новый корабль").
    //
    // Scales each hull's cost so maxing its ENTIRE deck costs the same
    // ~4× multiple of that hull's own price on every tier, instead of the
    // same flat cost regardless of tier — multiplier(type) = 4 *
    // price(type) / cannon_count(type) / 16200 (16200 = the new level_cost
    // curve's own total), rounded for legibility. Lower than the ~6×
    // this first landed on, too — the goal isn't just "proportional to
    // hull price now", it's "actually worth investing in", and 6× still
    // read as a lot of gold for a gun that isn't the whole ship. Applied
    // in Ship::cannonUpgradeCost, so GunsmithController and
    // PortController's downgrade refund (which reads real spend back
    // through that same method) both stay correct automatically.
    'cost_multiplier' => [
        'boat' => 0.21,
        'schooner' => 0.25,
        'caravel' => 0.26,
        'brig' => 0.39,
        'frigate' => 0.49,
        'galleon' => 0.67,
        'corvette' => 1.37,
        'battleship' => 1.65,
    ],

    // damage/range/speed at level 0 (unupgraded) — a level L cannon's stat
    // is base * (1 + level_bonus_fraction * L).
    //
    // range was originally 260/355/484/660/900/1227/1000/1673 — a Galleon
    // could hit something roughly half a typical screen away, so far the
    // shot that hit you was never even visible. Scaled down ~×0.3 across
    // the board (same ~×1.36-per-tier ratios, so the calibration goal above
    // still holds) to distances that actually fit on screen.
    //
    // boat/schooner/caravel's range got a second, TARGETED pass on top of
    // that — the ×0.3 scale-down left the bottom of the curve badly out of
    // proportion with how fast those hulls actually move (all three share
    // SHIP_SPEED_MULT 0.75 in WorldRoom.js, i.e. the same 165u/s): a
    // boat's stock 78 range was under half a second of its own movement
    // (78/165 ≈ 0.47s) versus a Battleship's ~1.5s of its own — direct
    // feedback that a Шлюпка genuinely couldn't land a shot, the range was
    // gone before you could close it. Retargeted to roughly 0.9/1.0/1.1s of
    // each hull's own move speed (brig's untouched 198/165 ≈ 1.2s was the
    // ceiling to grow into, not match — still monotonically increasing).
    // Ball speed nudged up alongside range for these three specifically —
    // a longer flight path with the OLD speed meant more hang-time for a
    // target to react before impact, working against the very fix range
    // was just given. This does compress the ~×1.36 growth ratio at the
    // very bottom of the curve (a maxed Шлюпка cannon now lands close to a
    // stock Шхуна's, not clearly under it) — an accepted, bounded trade at
    // the entry tier specifically, not a general recalibration.
    'base' => [
        'boat' => ['damage' => 15, 'range' => 148, 'speed' => 700],
        'schooner' => ['damage' => 20, 'range' => 165, 'speed' => 730],
        'caravel' => ['damage' => 27, 'range' => 182, 'speed' => 760],
        'brig' => ['damage' => 37, 'range' => 198, 'speed' => 750],
        'frigate' => ['damage' => 50, 'range' => 270, 'speed' => 820],
        'galleon' => ['damage' => 69, 'range' => 368, 'speed' => 900],
        'corvette' => ['damage' => 55, 'range' => 300, 'speed' => 1600],
        'battleship' => ['damage' => 94, 'range' => 502, 'speed' => 1000],
    ],
];
