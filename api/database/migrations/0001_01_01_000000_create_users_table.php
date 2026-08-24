<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();

            // Provider-agnostic identity: a user may arrive via Telegram, Google,
            // or manual registration — at least one of these three is set, never
            // all filled in automatically (account linking is a deliberate,
            // user-initiated action, not an automatic merge by matching fields).
            $table->unsignedBigInteger('telegram_id')->nullable()->unique();
            $table->string('google_id')->nullable()->unique();
            $table->string('email')->nullable()->unique();
            $table->string('password')->nullable();

            $table->string('username')->nullable();
            $table->string('first_name')->nullable();
            $table->unsignedInteger('coins')->default(0);
            $table->unsignedInteger('level')->default(0);

            // Stub for future multi-server support (see architecture DECK 07):
            // always "main" today, exists so routing by server later is a data
            // migration, not a schema change.
            $table->string('server_id')->default('main');

            $table->rememberToken();
            $table->timestamps();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->foreignId('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('sessions');
    }
};
