<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['user_id', 'type', 'hp', 'x', 'y'])]
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

    public function stats(): array
    {
        return config("ships.{$this->type}");
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
