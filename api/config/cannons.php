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
    // Cost to go from level (L-1) to L, per cannon, 1-indexed by target level.
    'level_cost' => [500, 1500, 4000, 10000, 25000],

    // damage/range/speed at level 0 (unupgraded) — a level L cannon's stat
    // is base * (1 + level_bonus_fraction * L).
    //
    // range was originally 260/355/484/660/900/1227/1000/1673 — a Galleon
    // could hit something roughly half a typical screen away, so far the
    // shot that hit you was never even visible. Scaled down ~×0.3 across
    // the board (same ~×1.36-per-tier ratios, so the calibration goal above
    // still holds) to distances that actually fit on screen.
    'base' => [
        'boat' => ['damage' => 15, 'range' => 78, 'speed' => 600],
        'schooner' => ['damage' => 20, 'range' => 107, 'speed' => 650],
        'caravel' => ['damage' => 27, 'range' => 145, 'speed' => 700],
        'brig' => ['damage' => 37, 'range' => 198, 'speed' => 750],
        'frigate' => ['damage' => 50, 'range' => 270, 'speed' => 820],
        'galleon' => ['damage' => 69, 'range' => 368, 'speed' => 900],
        'corvette' => ['damage' => 55, 'range' => 300, 'speed' => 1600],
        'battleship' => ['damage' => 94, 'range' => 502, 'speed' => 1000],
    ],
];
