<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ShipController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $ship = $request->user()->ship()->with(['products', 'sailors'])->firstOrFail();

        return response()->json(['ship' => $this->serialize($ship), 'coins' => $request->user()->coins]);
    }

    public static function serialize(\App\Models\Ship $ship): array
    {
        return [
            'id' => $ship->id,
            'type' => $ship->type,
            'name' => $ship->stats()['name'],
            'hp' => $ship->hp,
            'max_hp' => $ship->maxHp(),
            'x' => $ship->x,
            'y' => $ship->y,
            'capacity' => $ship->capacity(),
            'cargo_weight' => $ship->cargoWeight(),
            'max_sailors' => $ship->stats()['max_sailors'],
            'sailor_count' => $ship->sailorCount(),
            'products' => $ship->products->mapWithKeys(fn ($p) => [$p->type => $p->quantity]),
            'sailors' => $ship->sailors->mapWithKeys(fn ($s) => [$s->type => $s->count]),
            // Hull-level stats (naval combat) — distinct from the captain's
            // own melee stats below (boarding combat).
            'speed' => $ship->stats()['speed'],
            'protection' => $ship->stats()['protection'],
            'dodge' => $ship->stats()['dodge'],
            'cannon_count' => $ship->stats()['cannon_count'],
            // Captain (boarding combat) — see Ship::captainStats, the
            // original's Captain.Set_Cap_Prop derived from hired sailors.
            'captain' => $ship->captainStats(),
        ];
    }
}
