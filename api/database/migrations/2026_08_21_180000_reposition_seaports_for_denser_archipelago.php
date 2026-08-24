<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * The archipelago got denser (worldgen.js: CLUSTER_COUNT 6 -> 14) and
     * islands are now procedurally placed, not the old hand-picked circles
     * these four ports were pinned next to — they'd ended up floating in
     * open water. Coordinates below are real shore points (computed from
     * generateIslands() with the current WORLD_SEED, not guessed) on eight
     * different islands spread across the map, so "enter port" triggers
     * right at the coastline instead of out in the water. Four new ports
     * added at the same time — four cities felt sparse against a map this
     * size with this many islands now visitable.
     */
    public function up(): void
    {
        $existing = [
            'Порт-Рояль' => ['x' => 981, 'y' => 2462],
            'Нассау' => ['x' => 3909, 'y' => 2816],
            'Тортуга' => ['x' => 3633, 'y' => 1563],
            'Гавана' => ['x' => 364, 'y' => 2271],
        ];

        foreach ($existing as $name => $pos) {
            DB::table('seaports')->where('name', $name)->update($pos);
        }

        $now = now();
        DB::table('seaports')->insert([
            ['name' => 'Сантьяго', 'x' => 4213, 'y' => 3162, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'Кингстон', 'x' => 3255, 'y' => 1017, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'Кампече', 'x' => 748, 'y' => 3149, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'Маракайбо', 'x' => 1618, 'y' => 2465, 'created_at' => $now, 'updated_at' => $now],
        ]);
    }

    public function down(): void
    {
        DB::table('seaports')->whereIn('name', ['Сантьяго', 'Кингстон', 'Кампече', 'Маракайбо'])->delete();

        $previous = [
            'Порт-Рояль' => ['x' => 1000, 'y' => 840],
            'Нассау' => ['x' => 3945, 'y' => 800],
            'Тортуга' => ['x' => 450, 'y' => 3600],
            'Гавана' => ['x' => 4000, 'y' => 4170],
        ];

        foreach ($previous as $name => $pos) {
            DB::table('seaports')->where('name', $name)->update($pos);
        }
    }
};
