<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->foreignId('opponent_user_id')->nullable()->after('user_id')->constrained('users')->nullOnDelete();

            // Async round exchange, same shape as battle-arena's PvpBattleService —
            // both sides submit independently, resolved once both are in (or on timeout).
            $table->string('a_pending_attack')->nullable();
            $table->json('a_pending_defend')->nullable();
            $table->string('b_pending_attack')->nullable();
            $table->json('b_pending_defend')->nullable();
            $table->timestamp('round_deadline_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('opponent_user_id');
            $table->dropColumn(['a_pending_attack', 'a_pending_defend', 'b_pending_attack', 'b_pending_defend', 'round_deadline_at']);
        });
    }
};
