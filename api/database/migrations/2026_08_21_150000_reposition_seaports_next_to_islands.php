<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Two fixes at once: the map doubled in size (MAP_SIZE 2400 -> 4800, see
     * WorldRoom.js/WorldPage.vue — the original bot-density feedback), and
     * ports were floating in open water instead of sitting next to the
     * island they belong to. Each port now sits just outside its island's
     * collision radius (safely clear, but visibly docked against it).
     */
    public function up(): void
    {
        $positions = [
            'Порт-Рояль' => ['x' => 1000, 'y' => 840],  // island at (1000,1000) r70
            'Нассау' => ['x' => 3945, 'y' => 800],       // island at (3800,800) r55
            'Тортуга' => ['x' => 450, 'y' => 3600],      // island at (600,3600) r60
            'Гавана' => ['x' => 4000, 'y' => 4170],      // island at (4000,4000) r80
        ];

        foreach ($positions as $name => $pos) {
            DB::table('seaports')->where('name', $name)->update($pos);
        }
    }

    public function down(): void
    {
        $positions = [
            'Порт-Рояль' => ['x' => 1200, 'y' => 200],
            'Нассау' => ['x' => 2300, 'y' => 1200],
            'Тортуга' => ['x' => 150, 'y' => 1200],
            'Гавана' => ['x' => 1200, 'y' => 2300],
        ];

        foreach ($positions as $name => $pos) {
            DB::table('seaports')->where('name', $name)->update($pos);
        }
    }
};
