<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('type')->default('boat');
            $table->unsignedInteger('hp');
            // Last known position in the shared world — read/written by the
            // realtime service on join/leave so a player resumes where they
            // left off instead of respawning at the map center every time.
            $table->float('x')->default(1200);
            $table->float('y')->default(1200);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ships');
    }
};
