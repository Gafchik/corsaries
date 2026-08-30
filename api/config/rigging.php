<?php

// Оснастка — three ship-wide upgrade tracks (see Ship::riggingStatsAt),
// each boosting one of a hull's own base stats from config/ships.php:
// sails -> speed, hull -> protection, tackle -> dodge. Deliberately NOT a
// per-slot system like config/cannons.php's cannons — a ship has one set
// of sails, not a countable slot per mast, so each track is a single
// level 0-5, not N independent upgrades.
//
// Same shape as cannons on purpose (level_bonus_fraction, level_cost,
// cost_multiplier are identical to config/cannons.php's current values) —
// explicit user request, not calibrated against "next tier's base stat"
// the way cannon damage/range are: speed/protection/dodge aren't
// monotonically increasing across SHIP_TYPES tier order the way damage/
// range are (e.g. dodge: Шлюпка 30 -> Бриг 20 -> Корвет 40 -> Линкор 15),
// so "maxed tier N = tier N+1's base" isn't a meaningful target for these
// three. A flat +10%/level of the hull's OWN base stat, same as cannons,
// max +50% at level 5.
return [
    'levels' => 5,
    'level_bonus_fraction' => 0.10,

    // Identical curve/scaling to config/cannons.php (see that file's own
    // comment for the reasoning behind the shape and the per-tier ~4x
    // target) — reused rather than shared to keep each config file
    // self-contained, same as cannons.php's own relationship to ships.php.
    // Costs here are PER TRACK, not multiplied by any slot count (each
    // track is always exactly one purchase line) — e.g. a Шлюпка maxing
    // Паруса alone costs the same ~3,402 gold as maxing one of its
    // cannons, not ~20,000 (6 cannons' worth).
    'level_cost' => [500, 1200, 2500, 4500, 7500],
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

    // track key => [db column, ships.php stat key, display name]. Single
    // source of truth for RiggingController/Ship — add a track here and
    // both pick it up automatically.
    'tracks' => [
        'sails' => ['column' => 'sails_level', 'stat' => 'speed', 'name' => 'Паруса'],
        'hull' => ['column' => 'hull_level', 'stat' => 'protection', 'name' => 'Корпус'],
        'tackle' => ['column' => 'tackle_level', 'stat' => 'dodge', 'name' => 'Такелаж'],
    ],
];
