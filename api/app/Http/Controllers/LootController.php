<?php

namespace App\Http\Controllers;

use App\Models\LootOffer;
use App\Models\ShipProduct;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LootController extends Controller
{
    public function show(Request $request, int $offerId): JsonResponse
    {
        $offer = LootOffer::where('id', $offerId)->where('user_id', $request->user()->id)->first();

        if ($offer === null || $offer->status !== 'pending' || $offer->isExpired()) {
            return response()->json(['error' => ['message' => 'Эта добыча уже недоступна.']], 404);
        }

        $ship = $request->user()->ship()->with('products')->firstOrFail();

        return response()->json([
            'offer' => [
                'id' => $offer->id,
                'items' => collect($offer->items)->map(fn ($qty, $type) => [
                    'type' => $type,
                    'name' => config("products.{$type}.name"),
                    'weight' => config("products.{$type}.weight"),
                    'available' => $qty,
                ])->values(),
            ],
            'ship' => [
                'capacity' => $ship->capacity(),
                'cargo_weight' => $ship->cargoWeight(),
            ],
        ]);
    }

    public function claim(Request $request, int $offerId): JsonResponse
    {
        $data = $request->validate([
            'items' => ['required', 'array'],
            'items.*' => ['integer', 'min:0'],
        ]);

        $offer = LootOffer::where('id', $offerId)->where('user_id', $request->user()->id)->first();

        if ($offer === null || $offer->status !== 'pending' || $offer->isExpired()) {
            return response()->json(['error' => ['message' => 'Эта добыча уже недоступна.']], 404);
        }

        $ship = $request->user()->ship()->with('products')->firstOrFail();
        $addedWeight = 0;

        foreach ($data['items'] as $type => $quantity) {
            $available = $offer->items[$type] ?? 0;
            // Never trust the client past what the offer actually contains —
            // clamp rather than trust a larger number it might send.
            $quantity = min($quantity, $available);
            if ($quantity <= 0) {
                continue;
            }

            $addedWeight += $quantity * config("products.{$type}.weight", 0);
        }

        if ($ship->cargoWeight() + $addedWeight > $ship->capacity()) {
            return response()->json(['error' => ['message' => 'Не хватает места в трюме — возьми меньше или продай что-то в порту.']], 400);
        }

        foreach ($data['items'] as $type => $quantity) {
            $quantity = min($quantity, $offer->items[$type] ?? 0);
            if ($quantity <= 0) {
                continue;
            }

            $row = ShipProduct::firstOrCreate(['ship_id' => $ship->id, 'type' => $type], ['quantity' => 0]);
            $row->increment('quantity', $quantity);
        }

        $offer->update(['status' => 'claimed']);

        return response()->json(['ship' => ShipController::serialize($ship->fresh(['products', 'sailors']))]);
    }
}
