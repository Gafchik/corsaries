<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Previous pass (baseRadius * 0.55 from island center) put ports too
     * deep inland — no visual cue for which side of the island to approach
     * from. Recomputed at 85% of the island's *actual* shore radius at the
     * port's angle (not the average baseRadius), so the icon sits right
     * near the coastline facing open water, still safely on land.
     */
    public function up(): void
    {
        $now = now();
        $positions = [
            'Порт-Рояль' => ['x' => 1185, 'y' => 2153],
            'Нассау' => ['x' => 3905, 'y' => 2915],
            'Тортуга' => ['x' => 3695, 'y' => 1556],
            'Гавана' => ['x' => 285, 'y' => 2822],
            'Сантьяго' => ['x' => 2316, 'y' => 162],
            'Кингстон' => ['x' => 3243, 'y' => 2427],
            'Кампече' => ['x' => 4412, 'y' => 1912],
            'Маракайбо' => ['x' => 1397, 'y' => 3292],
        ];

        foreach ($positions as $name => $pos) {
            DB::table('seaports')->where('name', $name)->update($pos);
        }
    }

    public function down(): void
    {
        // No sensible rollback — see previous migration's own note.
    }
};
