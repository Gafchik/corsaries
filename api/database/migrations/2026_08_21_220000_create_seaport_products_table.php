<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Direct port of Seaport.SetPortState — each port rolls its own
     * price/stock per product, independently of every other port. The
     * original called this once at port creation and (by clear intent,
     * even though a stray line in Game1.cs's food-consumption catch block
     * meant it barely ever actually re-ran) again once per in-game day —
     * the whole point being a product could be cheap here and dear two
     * ports over, worth sailing for. Rerolling it fresh on every single
     * page visit (the previous implementation) made that impossible to
     * ever notice. This table is what makes a port's prices durable
     * between visits — see PortController's refresh-if-stale logic.
     */
    public function up(): void
    {
        Schema::create('seaport_products', function (Blueprint $table) {
            $table->id();
            $table->foreignId('seaport_id')->constrained()->cascadeOnDelete();
            $table->string('type');
            $table->unsignedInteger('price');
            $table->unsignedInteger('stock');
            $table->timestamps();
            $table->unique(['seaport_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('seaport_products');
    }
};
