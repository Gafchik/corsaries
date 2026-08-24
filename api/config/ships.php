<?php

// Static ship-type stat table — a direct port of Ship.Set_Ship_Type from the
// original C#. Buying a new ship type is a full replacement, not a modular
// upgrade, same as the original.
return [
    'boat' => [
        'name' => 'Шлюпка', 'price' => 5000, 'capacity' => 350, 'max_hp' => 500,
        'speed' => 0.75, 'cannon_count' => 4, 'max_sailors' => 10, 'protection' => 10, 'dodge' => 30,
    ],
    'schooner' => [
        'name' => 'Шхуна', 'price' => 10000, 'capacity' => 650, 'max_hp' => 1000,
        'speed' => 0.75, 'cannon_count' => 6, 'max_sailors' => 20, 'protection' => 15, 'dodge' => 30,
    ],
    'caravel' => [
        'name' => 'Каравелла', 'price' => 15000, 'capacity' => 800, 'max_hp' => 2000,
        'speed' => 0.75, 'cannon_count' => 8, 'max_sailors' => 25, 'protection' => 25, 'dodge' => 35,
    ],
    'brig' => [
        'name' => 'Бриг', 'price' => 25000, 'capacity' => 950, 'max_hp' => 2300,
        'speed' => 0.75, 'cannon_count' => 8, 'max_sailors' => 30, 'protection' => 30, 'dodge' => 20,
    ],
    'frigate' => [
        'name' => 'Фрегат', 'price' => 40000, 'capacity' => 1250, 'max_hp' => 4000,
        'speed' => 1.0, 'cannon_count' => 10, 'max_sailors' => 40, 'protection' => 30, 'dodge' => 20,
    ],
    'galleon' => [
        'name' => 'Галеон', 'price' => 65000, 'capacity' => 1550, 'max_hp' => 6500,
        'speed' => 1.25, 'cannon_count' => 12, 'max_sailors' => 50, 'protection' => 35, 'dodge' => 15,
    ],
    'corvette' => [
        'name' => 'Корвет', 'price' => 100000, 'capacity' => 1250, 'max_hp' => 6700,
        'speed' => 2.0, 'cannon_count' => 10, 'max_sailors' => 40, 'protection' => 20, 'dodge' => 40,
    ],
    'battleship' => [
        'name' => 'Линкор', 'price' => 200000, 'capacity' => 2200, 'max_hp' => 10000,
        'speed' => 1.5, 'cannon_count' => 12, 'max_sailors' => 70, 'protection' => 60, 'dodge' => 15,
    ],
];
