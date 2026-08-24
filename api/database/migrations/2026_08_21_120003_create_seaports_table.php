<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('seaports', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->float('x');
            $table->float('y');
            $table->timestamps();
        });

        // Fixed placeholder layout, clear of the islands hand-placed in
        // WorldRoom.js/WorldPage.vue (MAP_SIZE 2400) — same "manually placed,
        // not procedural" approach as the original for now.
        $now = now();
        DB::table('seaports')->insert([
            ['name' => 'Порт-Рояль', 'x' => 1200, 'y' => 200, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'Нассау', 'x' => 2300, 'y' => 1200, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'Тортуга', 'x' => 150, 'y' => 1200, 'created_at' => $now, 'updated_at' => $now],
            ['name' => 'Гавана', 'x' => 1200, 'y' => 2300, 'created_at' => $now, 'updated_at' => $now],
        ]);
    }

    public function down(): void
    {
        Schema::dropIfExists('seaports');
    }
};
