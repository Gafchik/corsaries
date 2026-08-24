<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Islands got bigger (worldgen.js BASE_RADIUS_RANGE [50,95] -> [110,200])
     * and fewer/further apart (CLUSTER_COUNT 14 -> 10, spacing up), which
     * reshuffles every downstream random() call — the previous migration's
     * coordinates (picked against the intermediate config) no longer land on
     * real islands. These are computed fresh against the current worldgen.js
     * and, unlike the last pass, sit well *inside* each island's land
     * (baseRadius * 0.55 from center, safely under the shore's minimum
     * possible radius at any angle) instead of exactly on the coastline —
     * a marker right at the noisy edge could visually clip into water.
     */
    public function up(): void
    {
        $now = now();
        $positions = [
            'Порт-Рояль' => ['x' => 1083, 'y' => 2153],
            'Нассау' => ['x' => 3895, 'y' => 2915],
            'Тортуга' => ['x' => 3608, 'y' => 1556],
            'Гавана' => ['x' => 232, 'y' => 2822],
            'Сантьяго' => ['x' => 2245, 'y' => 162],
            'Кингстон' => ['x' => 3183, 'y' => 2427],
            'Кампече' => ['x' => 4333, 'y' => 1912],
            'Маракайбо' => ['x' => 1347, 'y' => 3292],
        ];

        foreach ($positions as $name => $pos) {
            DB::table('seaports')->updateOrInsert(
                ['name' => $name],
                array_merge($pos, ['updated_at' => $now, 'created_at' => $now])
            );
        }
    }

    public function down(): void
    {
        // No sensible rollback — previous coordinates are already stale
        // against whatever worldgen.js looked like before this migration.
    }
};
