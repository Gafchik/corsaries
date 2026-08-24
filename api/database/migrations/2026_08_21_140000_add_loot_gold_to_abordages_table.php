<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->unsignedInteger('loot_gold')->nullable()->after('winner');
        });
    }

    public function down(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->dropColumn('loot_gold');
        });
    }
};
