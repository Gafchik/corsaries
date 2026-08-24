<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Wires the original's Captain stats (Set_Cap_Prop: damage/defense/
     * dodge/crit, all derived from sailor composition — see Ship::
     * captainStats()) into actual combat, which BattleEngine wasn't using
     * at all before this — every fight was a flat 30/15 regardless of who
     * you hired. Snapshotted at abordage start, same as a_hp/b_hp already
     * are, so mid-fight tavern visits can't retroactively change stats.
     */
    public function up(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->unsignedSmallInteger('a_damage')->default(5)->after('a_max_hp');
            $table->unsignedSmallInteger('a_defense')->default(0)->after('a_damage');
            $table->unsignedSmallInteger('a_dodge')->default(0)->after('a_defense');
            $table->unsignedSmallInteger('a_crit')->default(0)->after('a_dodge');
            $table->unsignedSmallInteger('b_damage')->default(5)->after('b_max_hp');
            $table->unsignedSmallInteger('b_defense')->default(0)->after('b_damage');
            $table->unsignedSmallInteger('b_dodge')->default(0)->after('b_defense');
            $table->unsignedSmallInteger('b_crit')->default(0)->after('b_dodge');
        });
    }

    public function down(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->dropColumn(['a_damage', 'a_defense', 'a_dodge', 'a_crit', 'b_damage', 'b_defense', 'b_dodge', 'b_crit']);
        });
    }
};
