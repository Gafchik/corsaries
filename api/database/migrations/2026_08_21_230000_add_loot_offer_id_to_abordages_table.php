<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Winning an abordage was gold-only — the naval combat path (sinking a
     * ship out in the world) already lets the winner choose real cargo via
     * a LootOffer, boarding never did. Same offer flow, just created from
     * AbordagePveService/AbordagePvpService instead of WorldRoom.js.
     */
    public function up(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->foreignId('loot_offer_id')->nullable()->after('loot_gold')->constrained('loot_offers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('abordages', function (Blueprint $table) {
            $table->dropConstrainedForeignId('loot_offer_id');
        });
    }
};
