<?php

use App\Http\Controllers\AbordageController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ControlsController;
use App\Http\Controllers\GunsmithController;
use App\Http\Controllers\LootController;
use App\Http\Controllers\PortController;
use App\Http\Controllers\RiggingController;
use App\Http\Controllers\ShipController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::post('/telegram', [AuthController::class, 'telegram']);
    Route::post('/register', [AuthController::class, 'register']);
    Route::post('/login', [AuthController::class, 'login']);
    Route::post('/google', [AuthController::class, 'google']);

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/logout', [AuthController::class, 'logout']);
        Route::post('/link/telegram', [AuthController::class, 'linkTelegram']);
        Route::post('/link/google', [AuthController::class, 'linkGoogle']);
    });
});

// No auth: needed by the realtime service (WorldRoom.js) to fenc off a
// safe zone around each port for bot aggro, and by nothing sensitive —
// port names/coordinates are shown to any player anyway.
Route::get('/public/ports', [PortController::class, 'index']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/ship', [ShipController::class, 'show']);

    Route::get('/controls', [ControlsController::class, 'show']);
    Route::put('/controls', [ControlsController::class, 'update']);

    Route::get('/ports', [PortController::class, 'index']);
    Route::get('/ports/{port}', [PortController::class, 'show']);
    Route::post('/ports/{port}/trade', [PortController::class, 'trade']);
    Route::post('/ports/{port}/market/sell-all', [PortController::class, 'sellAll']);
    Route::post('/ports/{port}/shipyard', [PortController::class, 'buyShip']);
    Route::post('/ports/{port}/tavern', [PortController::class, 'tavern']);
    Route::post('/ports/{port}/repair', [PortController::class, 'repair']);
    Route::get('/ports/{port}/cannons', [GunsmithController::class, 'index']);
    Route::post('/ports/{port}/cannons/{slot}/upgrade', [GunsmithController::class, 'upgrade']);
    Route::get('/ports/{port}/rigging', [RiggingController::class, 'index']);
    Route::post('/ports/{port}/rigging/{track}/upgrade', [RiggingController::class, 'upgrade']);

    Route::post('/abordage/pve', [AbordageController::class, 'startPve']);
    Route::post('/abordage/pvp', [AbordageController::class, 'startPvp']);
    Route::get('/abordage/{abordageId}', [AbordageController::class, 'show']);
    Route::post('/abordage/{abordageId}/move', [AbordageController::class, 'move']);

    Route::get('/loot/{offerId}', [LootController::class, 'show']);
    Route::post('/loot/{offerId}/claim', [LootController::class, 'claim']);
});
