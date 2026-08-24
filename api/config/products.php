<?php

// Base price is a reference point — actual port prices are randomized
// around this on every visit (SetPortState in the original never persisted
// port prices either).
return [
    'rum' => ['name' => 'Ром', 'weight' => 1, 'base_price' => 20],
    'silk' => ['name' => 'Шёлк', 'weight' => 2, 'base_price' => 50],
    'water' => ['name' => 'Вода', 'weight' => 1, 'base_price' => 5],
    'food' => ['name' => 'Еда', 'weight' => 1, 'base_price' => 10],
    'leather' => ['name' => 'Кожа', 'weight' => 10, 'base_price' => 30],
    'wood' => ['name' => 'Дерево', 'weight' => 20, 'base_price' => 20],
    'tobacco' => ['name' => 'Табак', 'weight' => 3, 'base_price' => 30],
    'coffee' => ['name' => 'Кофе', 'weight' => 7, 'base_price' => 20],
];
