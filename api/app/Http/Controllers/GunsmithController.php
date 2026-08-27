<?php

namespace App\Http\Controllers;

use App\Models\Seaport;
use App\Models\ShipCannon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Оружейник" — a per-cannon upgrade shop, deliberately separate from the
 * shipyard: buying a bigger hull (see PortController::buyShip) changes how
 * many cannons you have, this changes how good each individual one is (see
 * config/cannons.php and Ship::cannonStatsAt). A ship's cannon levels
 * persist across a shipyard purchase, same as its crew/cargo already do.
 */
class GunsmithController extends Controller
{
    // Same as PortController's own — duplicated rather than shared since
    // each controller's proximity check is otherwise fully self-contained,
    // and this is the one number the two need to agree on.
    private const PORT_ENTER_RANGE = 220;

    public function index(Request $request, Seaport $port): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        $ship = $request->user()->ship()->firstOrFail();
        $ship->ensureCannonSlots();

        return response()->json([
            'cannons' => $this->serializeCannons($ship),
            'coins' => $request->user()->coins,
        ]);
    }

    public function upgrade(Request $request, Seaport $port, int $slot): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        $ship = $request->user()->ship()->firstOrFail();
        $ship->ensureCannonSlots();

        // A slot number a smaller-hulled past self left behind (see
        // ensureCannonSlots' own comment — a downgrade orphans rows rather
        // than deleting paid-for levels) isn't a cannon THIS hull actually
        // has, even though the row still exists. Same bound serializeCannons
        // below uses to decide what to show at all.
        if ($slot >= $ship->stats()['cannon_count']) {
            return $this->error('Такой пушки нет на корабле.');
        }

        $cannon = ShipCannon::where('ship_id', $ship->id)->where('slot', $slot)->first();
        if (! $cannon) {
            return $this->error('Такой пушки нет на корабле.');
        }

        $cost = $ship->cannonUpgradeCost($cannon->level);
        if ($cost === null) {
            return $this->error('Эта пушка уже прокачана максимально.');
        }
        if ($request->user()->coins < $cost) {
            return $this->error('Недостаточно золота.');
        }

        $request->user()->decrement('coins', $cost);
        $cannon->increment('level');

        return response()->json([
            'cannons' => $this->serializeCannons($ship->fresh()),
            'coins' => $request->user()->fresh()->coins,
        ]);
    }

    private function serializeCannons(\App\Models\Ship $ship): array
    {
        // Only the current hull's own slots — a ship that downgraded still
        // has its old, bigger hull's extra rows sitting in the table (see
        // ensureCannonSlots' comment: orphaned on purpose, not deleted, so
        // the levels come back if the player buys that hull size again),
        // but a Шлюпка showing "30 пушек, все максимального уровня" left
        // over from a Линкор it isn't anymore was just confusing, not useful.
        return $ship->cannons()->where('slot', '<', $ship->stats()['cannon_count'])->orderBy('slot')->get()->map(fn (ShipCannon $cannon) => [
            'slot' => $cannon->slot,
            'level' => $cannon->level,
            'max_level' => config('cannons.levels'),
            'stats' => $ship->cannonStatsAt($cannon->level),
            'upgrade_cost' => $ship->cannonUpgradeCost($cannon->level),
        ])->values()->all();
    }

    /** Null when the ship is actually here; otherwise the error response to return immediately. Same check as PortController::proximityError. */
    private function proximityError(Request $request, Seaport $port): ?JsonResponse
    {
        $ship = $request->user()->ship()->first();
        if ($ship === null) {
            return $this->error('У тебя нет корабля.');
        }

        $distance = hypot($ship->x - $port->x, $ship->y - $port->y);
        if ($distance > self::PORT_ENTER_RANGE) {
            return $this->error('Корабль сейчас не у этого порта.');
        }

        return null;
    }

    private function error(string $message): JsonResponse
    {
        return response()->json(['error' => ['message' => $message]], 400);
    }
}
