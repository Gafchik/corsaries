<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Key/gamepad bindings used to live in the browser's localStorage — fine
// for a single device, but the same account picked up on a phone (or any
// other browser) started back at the defaults. Moving this to the account
// row makes a rebind follow the player everywhere.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->json('control_bindings')->nullable()->after('coins');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('control_bindings');
        });
    }
};
