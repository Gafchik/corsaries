<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Оснастка — three ship-wide upgrade tracks, unlike cannons a
        // single level each rather than N per-slot rows (there's one hull,
        // one set of sails, not a countable slot per mast), so plain
        // columns on the ship itself rather than a separate table. See
        // config/rigging.php for what each level actually does.
        Schema::table('ships', function (Blueprint $table) {
            $table->unsignedTinyInteger('sails_level')->default(0);
            $table->unsignedTinyInteger('hull_level')->default(0);
            $table->unsignedTinyInteger('tackle_level')->default(0);
        });
    }

    public function down(): void
    {
        Schema::table('ships', function (Blueprint $table) {
            $table->dropColumn(['sails_level', 'hull_level', 'tackle_level']);
        });
    }
};
