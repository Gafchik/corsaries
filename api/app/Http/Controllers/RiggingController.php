<?php

namespace App\Http\Controllers;

use App\Models\Seaport;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * "Оснастка" — three ship-wide upgrade tracks (Паруса/Корпус/Такелаж,
 * boosting speed/protection/dodge — see config/rigging.php), deliberately
 * separate from both the shipyard (which changes hull TYPE) and the
 * Оружейник (which is per-cannon-slot, not ship-wide). One level 0-5 per
 * track, not N independent slots.
 */
class RiggingController extends Controller
{
    // Same as GunsmithController/PortController's own — duplicated rather
    // than shared since each controller's proximity check is otherwise
    // fully self-contained, and this is the one number they need to agree on.
    private const PORT_ENTER_RANGE = 220;

    public function index(Request $request, Seaport $port): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        $ship = $request->user()->ship()->firstOrFail();

        return response()->json([
            'tracks' => $this->serializeTracks($ship),
            'coins' => $request->user()->coins,
        ]);
    }

    public function upgrade(Request $request, Seaport $port, string $track): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        if (! array_key_exists($track, config('rigging.tracks'))) {
            return $this->error('Такой оснастки не существует.');
        }

        $ship = $request->user()->ship()->firstOrFail();
        $column = config("rigging.tracks.{$track}.column");
        $level = $ship->{$column};

        $cost = $ship->riggingUpgradeCost($level);
        if ($cost === null) {
            return $this->error('Уже прокачано максимально.');
        }
        if ($request->user()->coins < $cost) {
            return $this->error('Недостаточно золота.');
        }

        $request->user()->decrement('coins', $cost);
        $ship->increment($column);

        return response()->json([
            'tracks' => $this->serializeTracks($ship->fresh()),
            'coins' => $request->user()->fresh()->coins,
        ]);
    }

    private function serializeTracks(\App\Models\Ship $ship): array
    {
        $result = [];
        foreach (config('rigging.tracks') as $key => $meta) {
            $level = $ship->{$meta['column']};
            $result[] = [
                'track' => $key,
                'name' => $meta['name'],
                'level' => $level,
                'max_level' => config('rigging.levels'),
                'current_value' => round($ship->riggingStatsAt($key, $level), 2),
                'next_value' => $level < config('rigging.levels') ? round($ship->riggingStatsAt($key, $level + 1), 2) : null,
                'upgrade_cost' => $ship->riggingUpgradeCost($level),
            ];
        }

        return $result;
    }

    /** Null when the ship is actually here; otherwise the error response to return immediately. Same check as PortController/GunsmithController::proximityError. */
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
