<?php

// Static ship-type stat table — a direct port of Ship.Set_Ship_Type from the
// original C#. Buying a new ship type is a full replacement, not a modular
// upgrade, same as the original.
//
// dodge specifically was pure decoration until config/rigging.php's
// Такелаж gave it (and protection) a real effect in combat (see
// resolveHit in WorldRoom.js) — these original 15-40% values were never
// tuned as an actual miss chance, just numbers that looked reasonable on a
// stat screen nobody's outcome depended on. Scaled down ~3x (direct
// feedback: even a stock hull with zero Такелаж invested was already
// eating 15-40% of incoming shots, before any upgrade choice at all) —
// same relative ordering (Корвет still the most evasive, Галеон/Линкор
// the least), just a floor that doesn't already feel unfair at level 0.
return [
    'boat' => [
        'name' => 'Шлюпка', 'price' => 5000, 'capacity' => 350, 'max_hp' => 500,
        // cannon_count was 4/6/8/8/10/12/10/12 before the per-cannon
        // upgrade system (see config/cannons.php) — flat and, at the top
        // end, literally tied between adjacent tiers (caravel==brig,
        // galleon==battleship), so a bigger hull didn't even mean more
        // guns half the time. Steeper now, and always split evenly in two
        // (left/right broadside) — see WorldRoom.js's handleFire.
        'speed' => 0.75, 'cannon_count' => 6, 'max_sailors' => 10, 'protection' => 10, 'dodge' => 10,
    ],
    'schooner' => [
        'name' => 'Шхуна', 'price' => 10000, 'capacity' => 650, 'max_hp' => 1000,
        'speed' => 0.75, 'cannon_count' => 10, 'max_sailors' => 20, 'protection' => 15, 'dodge' => 10,
    ],
    'caravel' => [
        'name' => 'Каравелла', 'price' => 15000, 'capacity' => 800, 'max_hp' => 2000,
        'speed' => 0.75, 'cannon_count' => 14, 'max_sailors' => 25, 'protection' => 25, 'dodge' => 12,
    ],
    'brig' => [
        'name' => 'Бриг', 'price' => 25000, 'capacity' => 950, 'max_hp' => 2300,
        'speed' => 0.75, 'cannon_count' => 16, 'max_sailors' => 30, 'protection' => 30, 'dodge' => 7,
    ],
    'frigate' => [
        'name' => 'Фрегат', 'price' => 40000, 'capacity' => 1250, 'max_hp' => 4000,
        'speed' => 1.0, 'cannon_count' => 20, 'max_sailors' => 40, 'protection' => 30, 'dodge' => 7,
    ],
    'galleon' => [
        'name' => 'Галеон', 'price' => 65000, 'capacity' => 1550, 'max_hp' => 6500,
        'speed' => 1.25, 'cannon_count' => 24, 'max_sailors' => 50, 'protection' => 35, 'dodge' => 5,
    ],
    'corvette' => [
        'name' => 'Корвет', 'price' => 100000, 'capacity' => 1250, 'max_hp' => 6700,
        // Fewer guns than the (cheaper) galleon on purpose — same
        // speed/dodge-over-firepower identity its per-cannon base stats in
        // config/cannons.php lean into too (faster balls, less damage/range).
        'speed' => 2.0, 'cannon_count' => 18, 'max_sailors' => 40, 'protection' => 20, 'dodge' => 13,
    ],
    'battleship' => [
        'name' => 'Линкор', 'price' => 200000, 'capacity' => 2200, 'max_hp' => 10000,
        'speed' => 1.5, 'cannon_count' => 30, 'max_sailors' => 70, 'protection' => 60, 'dodge' => 5,
    ],
];
