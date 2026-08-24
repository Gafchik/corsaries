<?php

// Crew are hired as stacks, not individuals — a Sailor type's boosts are
// summed across however many of that type are aboard and applied to the
// captain (see original Set_Cap_Prop). food_consumption is intentionally
// gone — see the "no offline starvation" decision.
return [
    'jung' => [
        'name' => 'Юнга', 'price' => 100,
        'hp_boost' => 1, 'damage_boost' => 0.3, 'defense_boost' => 0.1, 'dodge_boost' => 0.1, 'crit_boost' => 0.15,
    ],
    'experienced' => [
        'name' => 'Опытный матрос', 'price' => 300,
        'hp_boost' => 2, 'damage_boost' => 0.6, 'defense_boost' => 0.2, 'dodge_boost' => 0.2, 'crit_boost' => 0.2,
    ],
    'sea_wolf' => [
        'name' => 'Морской волк', 'price' => 900,
        'hp_boost' => 3, 'damage_boost' => 0.9, 'defense_boost' => 0.3, 'dodge_boost' => 0.3, 'crit_boost' => 0.3,
    ],
];
