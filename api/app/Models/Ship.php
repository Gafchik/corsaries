<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['user_id', 'type', 'hp', 'x', 'y', 'sails_level', 'hull_level', 'tackle_level'])]
class Ship extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function products(): HasMany
    {
        return $this->hasMany(ShipProduct::class);
    }

    public function sailors(): HasMany
    {
        return $this->hasMany(ShipSailor::class);
    }

    public function cannons(): HasMany
    {
        return $this->hasMany(ShipCannon::class);
    }

    /**
     * Creates whatever cannon slots this ship's current type should have
     * but doesn't yet — new slots start at level 0 (a freshly bought hull's
     * stock guns), existing slots (and their levels) are left untouched.
     * Called on first ship creation and every shipyard purchase (see
     * AuthController::ensureStarterShip, PortController::buyShip) — a
     * downgrade to a smaller hull just leaves the extra slots orphaned
     * rather than deleting upgrade progress a player paid real gold for.
     */
    public function ensureCannonSlots(): void
    {
        $existing = $this->cannons()->pluck('slot')->all();
        $wanted = $this->stats()['cannon_count'];

        for ($slot = 0; $slot < $wanted; $slot++) {
            if (! in_array($slot, $existing, true)) {
                ShipCannon::create(['ship_id' => $this->id, 'slot' => $slot, 'level' => 0]);
            }
        }
    }

    /** damage/range/speed/reload for one cannon at $level — see config/cannons.php's own comment for the calibration this is built to satisfy (reload deliberately isn't part of it — see that config's own note). */
    public function cannonStatsAt(int $level): array
    {
        $base = config("cannons.base.{$this->type}");
        $multiplier = 1 + config('cannons.level_bonus_fraction') * $level;
        $reloadMultiplier = 1 - config('cannons.reload_level_bonus_fraction') * $level;

        return [
            'damage' => (int) round($base['damage'] * $multiplier),
            'range' => (int) round($base['range'] * $multiplier),
            'speed' => (int) round($base['speed'] * $multiplier),
            'reload_ms' => (int) round(config('cannons.reload_base_ms') * $reloadMultiplier),
        ];
    }

    /** Gold to go from $level to $level+1, or null once already at the cap — see config/cannons.php's own comment on cost_multiplier for why this isn't the same flat number on every hull. */
    public function cannonUpgradeCost(int $level): ?int
    {
        $costs = config('cannons.level_cost');
        if (!isset($costs[$level])) {
            return null;
        }
        $multiplier = config("cannons.cost_multiplier.{$this->type}") ?? 1;

        return (int) round($costs[$level] * $multiplier);
    }

    public function stats(): array
    {
        return config("ships.{$this->type}");
    }

    /**
     * This hull's own base speed/protection/dodge (see stats()) boosted by
     * whatever Оснастка level is in that track — see config/rigging.php's
     * own comment for why this is a flat +10%/level rather than calibrated
     * against the next ship tier the way cannonStatsAt is.
     */
    public function riggingStatsAt(string $track, int $level): float
    {
        $meta = config("rigging.tracks.{$track}");
        $base = $this->stats()[$meta['stat']];
        $multiplier = 1 + config('rigging.level_bonus_fraction') * $level;

        return $base * $multiplier;
    }

    /** This ship's CURRENT effective speed/protection/dodge, i.e. riggingStatsAt() at whatever level is actually stored. */
    public function effectiveStat(string $track): float
    {
        $meta = config("rigging.tracks.{$track}");

        return $this->riggingStatsAt($track, $this->{$meta['column']});
    }

    /** Gold to go from $level to $level+1 in one Оснастка track, or null once already at the cap — same per-tier scaling as cannonUpgradeCost, see config/rigging.php's own comment. */
    public function riggingUpgradeCost(int $level): ?int
    {
        $costs = config('rigging.level_cost');
        if (!isset($costs[$level])) {
            return null;
        }
        $multiplier = config("rigging.cost_multiplier.{$this->type}") ?? 1;

        return (int) round($costs[$level] * $multiplier);
    }

    public function maxHp(): int
    {
        return $this->stats()['max_hp'];
    }

    public function capacity(): int
    {
        return $this->stats()['capacity'];
    }

    public function cargoWeight(): int
    {
        return $this->products->sum(fn (ShipProduct $p) => $p->quantity * config("products.{$p->type}.weight", 0));
    }

    public function sailorCount(): int
    {
        return $this->sailors->sum('count');
    }

    /**
     * Direct port of the original's Captain.Set_Cap_Prop: base stats plus
     * each hired sailor type's boost, summed across however many are
     * aboard. Requires $sailors to already be loaded (with('sailors')) —
     * not eager-loaded here to avoid a surprise query on every call.
     */
    public function captainStats(): array
    {
        $stats = ['hp' => 20, 'damage' => 5, 'defense' => 0, 'dodge' => 0, 'crit' => 0];

        foreach ($this->sailors as $sailor) {
            $boost = config("sailors.{$sailor->type}");
            if ($boost === null) {
                continue;
            }
            $stats['hp'] += $sailor->count * $boost['hp_boost'];
            $stats['damage'] += $sailor->count * $boost['damage_boost'];
            $stats['defense'] += $sailor->count * $boost['defense_boost'];
            $stats['dodge'] += $sailor->count * $boost['dodge_boost'];
            $stats['crit'] += $sailor->count * $boost['crit_boost'];
        }

        return array_map(fn ($v) => (int) $v, $stats);
    }

    /**
     * Boarding costs crew, not just cargo/gold — a hired crew used to be a
     * one-time purchase with no ongoing risk once aboard, which is exactly
     * what let a single well-crewed captain steamroll every fight forever
     * after (see AbordagePveService/AbordagePvpService). Survival scales
     * with however much of the captain's own HP was left when the fight
     * ended: a clean win barely thins the crew, a narrow win or an outright
     * loss (0% HP) can gut it. Applied per sailor-type stack independently
     * and floored, not rounded, so it never leaves more crew than the
     * fraction actually earned.
     */
    public function applyCasualties(float $survivalFraction): void
    {
        foreach ($this->sailors as $sailor) {
            $survivors = (int) floor($sailor->count * $survivalFraction);
            if ($survivors !== $sailor->count) {
                $sailor->update(['count' => $survivors]);
            }
        }
    }
}
