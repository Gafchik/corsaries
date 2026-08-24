<?php

namespace App\Http\Controllers;

use App\Models\Seaport;
use App\Models\SeaportProduct;
use App\Models\ShipProduct;
use App\Models\ShipSailor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PortController extends Controller
{
    // How long a port's rolled prices/stock stay put before the next visit
    // (by anyone) rerolls them — see marketFor(). The original's
    // SetPortState() was meant to re-run once per in-game day; there's no
    // paused single-player clock here to hang that on, so this is a plain
    // wall-clock period picked for a persistent multiplayer economy: long
    // enough that a price difference spotted at one port is still there by
    // the time you've sailed to sell it at another, short enough that the
    // market doesn't just go static.
    private const MARKET_REFRESH_MINUTES = 15;
    private const REPAIR_PRICE_PER_HP = 1;
    // Keep in sync with PORT_ENTER_RANGE in WorldRoom.js / WorldPage.vue —
    // the client only shows the "enter port" button this close, but nothing
    // stopped the port screen itself being reached any other way (browser
    // back after sailing off, or just the URL/API directly) and still
    // working. Every port action now re-checks this against the ship's
    // real, currently-saved position — not "did the page load," but "is
    // the ship actually here right now."
    private const PORT_ENTER_RANGE = 220;

    public function index(): JsonResponse
    {
        return response()->json(['ports' => Seaport::query()->get(['id', 'name', 'x', 'y'])]);
    }

    public function show(Request $request, Seaport $port): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        return response()->json([
            'port' => $port->only(['id', 'name', 'x', 'y']),
            'market' => $this->marketFor($port),
            'shipyard' => $this->shipyardOffers(),
            'tavern' => collect(config('sailors'))->map(fn ($s, $type) => ['type' => $type, ...$s])->values(),
            'repair_price_per_hp' => self::REPAIR_PRICE_PER_HP,
        ]);
    }

    public function trade(Request $request, Seaport $port): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        $data = $request->validate([
            'product' => ['required', 'string', 'in:'.implode(',', array_keys(config('products')))],
            'action' => ['required', 'in:buy,sell'],
            'quantity' => ['required', 'integer', 'min:1'],
        ]);

        $ship = $request->user()->ship()->firstOrFail();
        $productConfig = config("products.{$data['product']}");
        $this->marketFor($port); // primes/refreshes this port's rows if they're missing or stale
        $row = SeaportProduct::where('seaport_id', $port->id)->where('type', $data['product'])->first();
        // The price actually charged is whatever's persisted for this port
        // right now — the same number the market listing just showed. That
        // agreement is the entire point: spotting it cheap here and dear
        // two ports over only means something if the price doesn't quietly
        // change between browsing and buying.
        $unitPrice = $row->price;
        $totalPrice = $unitPrice * $data['quantity'];

        if ($data['action'] === 'buy') {
            if ($request->user()->coins < $totalPrice) {
                return $this->error('Недостаточно золота.');
            }
            if ($data['quantity'] > $row->stock) {
                return $this->error('В порту нет столько товара.');
            }

            $addedWeight = $productConfig['weight'] * $data['quantity'];
            if ($ship->cargoWeight() + $addedWeight > $ship->capacity()) {
                return $this->error('Не хватает места в трюме.');
            }

            $request->user()->decrement('coins', $totalPrice);
            $row->decrement('stock', $data['quantity']);
            $this->adjustStock($ship, $data['product'], $data['quantity']);
        } else {
            $owned = ShipProduct::where('ship_id', $ship->id)->where('type', $data['product'])->first()?->quantity ?? 0;
            if ($owned < $data['quantity']) {
                return $this->error('В трюме нет столько товара.');
            }

            $request->user()->increment('coins', $totalPrice);
            $this->adjustStock($ship, $data['product'], -$data['quantity']);
        }

        return response()->json(['ship' => ShipController::serialize($ship->fresh(['products', 'sailors'])), 'coins' => $request->user()->fresh()->coins]);
    }

    public function buyShip(Request $request, Seaport $port): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        $data = $request->validate([
            'type' => ['required', 'string', 'in:'.implode(',', array_keys(config('ships')))],
        ]);

        $price = config("ships.{$data['type']}.price");
        if ($request->user()->coins < $price) {
            return $this->error('Недостаточно золота.');
        }

        $ship = $request->user()->ship()->firstOrFail();
        $request->user()->decrement('coins', $price);
        $ship->update(['type' => $data['type'], 'hp' => config("ships.{$data['type']}.max_hp")]);

        return response()->json(['ship' => ShipController::serialize($ship->fresh(['products', 'sailors'])), 'coins' => $request->user()->fresh()->coins]);
    }

    public function tavern(Request $request, Seaport $port): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        $data = $request->validate([
            'type' => ['required', 'string', 'in:'.implode(',', array_keys(config('sailors')))],
            'action' => ['required', 'in:hire,fire'],
        ]);

        $ship = $request->user()->ship()->firstOrFail();

        if ($data['action'] === 'hire') {
            $price = config("sailors.{$data['type']}.price");
            if ($request->user()->coins < $price) {
                return $this->error('Недостаточно золота.');
            }
            if ($ship->sailorCount() + 1 > $ship->stats()['max_sailors']) {
                return $this->error('На корабле нет мест для экипажа.');
            }

            $request->user()->decrement('coins', $price);
            $row = ShipSailor::firstOrCreate(['ship_id' => $ship->id, 'type' => $data['type']], ['count' => 0]);
            $row->increment('count');
        } else {
            $row = ShipSailor::where('ship_id', $ship->id)->where('type', $data['type'])->first();
            if (! $row || $row->count < 1) {
                return $this->error('Такого матроса нет на борту.');
            }
            $row->decrement('count');
        }

        // Gold really was deducted above (hire) — just wasn't being sent
        // back, so the UI kept showing the stale pre-purchase balance until
        // the next full page load.
        return response()->json(['ship' => ShipController::serialize($ship->fresh(['products', 'sailors'])), 'coins' => $request->user()->fresh()->coins]);
    }

    public function repair(Request $request, Seaport $port): JsonResponse
    {
        if ($error = $this->proximityError($request, $port)) {
            return $error;
        }

        $ship = $request->user()->ship()->firstOrFail();
        $missing = $ship->maxHp() - $ship->hp;

        if ($missing <= 0) {
            return $this->error('Корабль уже цел.');
        }

        // Optional partial repair — how much HP to buy back, not how much
        // gold to spend, so the price-per-HP stays the single source of
        // truth either way. No amount sent falls back to "as much as the
        // wallet allows, capped at what's actually missing" — same
        // behavior full repair always had, just no longer an all-or-nothing
        // fail when you're a little short.
        $data = $request->validate([
            'amount' => ['sometimes', 'integer', 'min:1'],
        ]);
        $amount = min($data['amount'] ?? $missing, $missing);
        // Price is still server-decided, not taken from the client — same
        // principle as trade()'s price now: what's charged has to be the
        // real number, not whatever the request claims.
        $cost = $amount * self::REPAIR_PRICE_PER_HP;

        if ($request->user()->coins < $cost) {
            return $this->error('Недостаточно золота.');
        }

        $request->user()->decrement('coins', $cost);
        $ship->update(['hp' => $ship->hp + $amount]);

        return response()->json(['ship' => ShipController::serialize($ship->fresh(['products', 'sailors'])), 'coins' => $request->user()->fresh()->coins]);
    }

    /**
     * Refreshes this port's persisted prices/stock if they're missing or
     * older than MARKET_REFRESH_MINUTES, then returns the market listing
     * built from whatever's now on record — freshly rolled or not.
     */
    private function marketFor(Seaport $port): array
    {
        $rows = $port->products()->get()->keyBy('type');
        $stale = $rows->isEmpty() || $rows->min('updated_at')->lt(now()->subMinutes(self::MARKET_REFRESH_MINUTES));

        if ($stale) {
            $rows = $this->refreshMarket($port);
        }

        return collect(config('products'))->map(fn ($product, $type) => [
            'type' => $type,
            'name' => $product['name'],
            'weight' => $product['weight'],
            'price' => $rows[$type]->price,
            'stock' => $rows[$type]->stock,
        ])->values()->all();
    }

    private function refreshMarket(Seaport $port): \Illuminate\Support\Collection
    {
        foreach (config('products') as $type => $product) {
            SeaportProduct::updateOrCreate(
                ['seaport_id' => $port->id, 'type' => $type],
                ['price' => $this->rollPrice($product['base_price']), 'stock' => rand(20, 60)],
            );
        }

        return $port->products()->get()->keyBy('type');
    }

    /**
     * A wide ±40% band, not the old ±20% — the whole point of a port
     * rolling its own price independently is that the same product can be
     * worth actually sailing between two ports over, and a narrow band
     * made any difference too small to bother with.
     */
    private function rollPrice(int $basePrice): int
    {
        $variance = rand(-40, 40) / 100;

        return max(1, (int) round($basePrice * (1 + $variance)));
    }

    /** Null when the ship is actually here; otherwise the error response to return immediately. */
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

    private function shipyardOffers(): array
    {
        return collect(config('ships'))->map(fn ($s, $type) => ['type' => $type, ...$s])->values()->all();
    }

    private function adjustStock(\App\Models\Ship $ship, string $type, int $delta): void
    {
        $row = ShipProduct::firstOrCreate(['ship_id' => $ship->id, 'type' => $type], ['quantity' => 0]);
        $row->increment('quantity', $delta);
    }

    private function error(string $message): JsonResponse
    {
        return response()->json(['error' => ['message' => $message]], 400);
    }
}
