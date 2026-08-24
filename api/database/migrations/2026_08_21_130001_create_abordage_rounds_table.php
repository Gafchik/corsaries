<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('abordage_rounds', function (Blueprint $table) {
            $table->id();
            $table->foreignId('abordage_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('round');
            $table->string('a_attack')->nullable();
            $table->json('a_defend')->nullable();
            $table->string('b_attack')->nullable();
            $table->json('b_defend')->nullable();
            $table->unsignedInteger('a_damage');
            $table->unsignedInteger('b_damage');
            $table->boolean('a_blocked');
            $table->boolean('b_blocked');
            $table->unsignedInteger('a_hp_after');
            $table->unsignedInteger('b_hp_after');
            $table->text('text');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('abordage_rounds');
    }
};
