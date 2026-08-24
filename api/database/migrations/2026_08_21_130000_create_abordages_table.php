<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('abordages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('mode')->default('pve'); // pve now; pvp is a later pass
            $table->string('bot_ship_type')->nullable(); // which world-bot tier this captain was scaled to
            $table->unsignedInteger('a_hp');
            $table->unsignedInteger('a_max_hp');
            $table->unsignedInteger('b_hp');
            $table->unsignedInteger('b_max_hp');
            $table->string('status')->default('in_progress'); // in_progress|completed
            $table->string('winner')->nullable(); // a|b|draw
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('abordages');
    }
};
