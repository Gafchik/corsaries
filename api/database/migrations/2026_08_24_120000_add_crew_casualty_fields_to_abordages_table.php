<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Crew casualties (see Ship::applyCasualties) happen the instant a fight
// ends and nothing else was recording it — a player had no way to see how
// much of their crew a fight actually cost them. Snapshotting before/after
// counts on the abordage row itself means the result screen can show it
// even on a later GET, not just in the response of the move that ended the
// fight. b_* stays null for PvE — a bot has no real crew to lose.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->unsignedInteger('a_crew_before')->nullable()->after('winner');
            $table->unsignedInteger('a_crew_after')->nullable()->after('a_crew_before');
            $table->unsignedInteger('b_crew_before')->nullable()->after('a_crew_after');
            $table->unsignedInteger('b_crew_after')->nullable()->after('b_crew_before');
        });
    }

    public function down(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->dropColumn(['a_crew_before', 'a_crew_after', 'b_crew_before', 'b_crew_after']);
        });
    }
};
