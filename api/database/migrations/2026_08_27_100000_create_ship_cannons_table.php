<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ship_cannons', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ship_id')->constrained()->cascadeOnDelete();
            // 0-indexed, split evenly in two by WorldRoom.js's handleFire
            // (first half = left broadside, second half = right) — not a
            // real physical position on the hull, just a stable identity
            // for "this specific cannon's level" across ship-type changes.
            $table->unsignedTinyInteger('slot');
            $table->unsignedTinyInteger('level')->default(0);
            $table->timestamps();

            $table->unique(['ship_id', 'slot']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ship_cannons');
    }
};
