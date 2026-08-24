<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ship_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('ship_id')->constrained()->cascadeOnDelete();
            $table->string('type');
            $table->unsignedInteger('quantity')->default(0);
            $table->timestamps();

            $table->unique(['ship_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ship_products');
    }
};
