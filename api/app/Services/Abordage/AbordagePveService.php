<?php

namespace App\Services\Abordage;

use App\Models\Abordage;
use App\Models\AbordageRound;
use App\Models\LootOffer;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class AbordagePveService
{
    private const BASE_CAPTAIN_HP = 20;
    // Mirrors WorldRoom.js's PRODUCT_TYPES/LOOT_LOSS_MIN/MAX — a boarded bot
    // has no real persisted hold any more than a sunk one does, so this is
    // the same "invent plausible cargo for a merchant of this tier" trick.
    private const PRODUCT_TYPES = ['rum', 'silk', 'water', 'food', 'leather', 'wood', 'tobacco', 'coffee'];
    private const LOOT_LOSS_MIN = 0.15;
    private const LOOT_LOSS_MAX = 0.35;

    // No LLM here on purpose — same call as the open-world bots: this is an
    // NPC captain, not the training-mode "outguess an opponent" gimmick
    // that justified an LLM call in battle-arena's PvE. A fair, unpredictable
    // random move is what Move_in_Battle-style bots need, not intelligence.
    public function __construct(
        private readonly BattleEngine $engine,
    ) {
    }

    public function start(User $user, ?string $botShipType): Abordage
    {
        $ship = $user->ship()->with('sailors')->firstOrFail();
        $humanStats = $ship->captainStats();

        $tier = $this->botTierIndex($botShipType);
        $botStats = $this->botCaptainStats($tier);

        return Abordage::create([
            'user_id' => $user->id,
            'mode' => 'pve',
            'bot_ship_type' => $botShipType,
            'a_hp' => $humanStats['hp'],
            'a_max_hp' => $humanStats['hp'],
            'a_damage' => $humanStats['damage'],
            'a_defense' => $humanStats['defense'],
            'a_dodge' => $humanStats['dodge'],
            'a_crit' => $humanStats['crit'],
            'b_hp' => $botStats['hp'],
            'b_max_hp' => $botStats['hp'],
            'b_damage' => $botStats['damage'],
            'b_defense' => $botStats['defense'],
            'b_dodge' => $botStats['dodge'],
            'b_crit' => $botStats['crit'],
            'status' => 'in_progress',
        ]);
    }

    /**
     * A bot has no real crew to derive stats from — scaled by the same tier
     * index world-bot ship types already use elsewhere (see WorldRoom.js).
     * The old coefficients (tier*4 hp, tier*2 damage) grew far too gently:
     * a fully-crewed boat — the cheapest ship, 10 sailors max — could already
     * out-stat a battleship-tier bot, so a low-tier attacker had no real
     * reason to ever lose. Roughly doubled the growth rate and pushed the
     * dodge/crit caps up so a high-tier bot is a genuine threat regardless
     * of what the attacker showed up in, not just a bigger HP bar to chew
     * through. Tier 0 is left close to before — a brand new player's first
     * few fights shouldn't suddenly get harder.
     */
    private function botCaptainStats(int $tier): array
    {
        return [
            'hp' => self::BASE_CAPTAIN_HP + $tier * 8,
            'damage' => 5 + $tier * 3,
            'defense' => $tier * 4,
            'dodge' => min(40, 8 + $tier * 4),
            'crit' => min(28, 8 + $tier * 2),
        ];
    }

    public function submitMove(Abordage $abordage, Move $humanMove): AbordageRound
    {
        if ($abordage->status !== 'in_progress') {
            throw new \RuntimeException('Этот абордаж уже завершён.');
        }

        $roundNumber = $abordage->rounds()->count() + 1;
        $botMove = $this->randomMove();

        $aStats = new CaptainStats($abordage->a_damage, $abordage->a_defense, $abordage->a_dodge, $abordage->a_crit);
        $bStats = new CaptainStats($abordage->b_damage, $abordage->b_defense, $abordage->b_dodge, $abordage->b_crit);
        $resolution = $this->engine->resolveRound($roundNumber, $abordage->a_hp, $abordage->b_hp, $humanMove, $botMove, $aStats, $bStats);

        return DB::transaction(function () use ($abordage, $roundNumber, $humanMove, $botMove, $resolution) {
            $round = AbordageRound::create([
                'abordage_id' => $abordage->id,
                'round' => $roundNumber,
                'a_attack' => $humanMove->attack->value,
                'a_defend' => array_map(fn (Zone $z) => $z->value, $humanMove->defend),
                'b_attack' => $botMove->attack->value,
                'b_defend' => array_map(fn (Zone $z) => $z->value, $botMove->defend),
                'a_damage' => $resolution->aDamage,
                'b_damage' => $resolution->bDamage,
                'a_blocked' => $resolution->aBlocked,
                'b_blocked' => $resolution->bBlocked,
                'a_hp_after' => $resolution->aHpAfter,
                'b_hp_after' => $resolution->bHpAfter,
                'text' => $resolution->text,
            ]);

            $finished = $resolution->aHpAfter <= 0 || $resolution->bHpAfter <= 0;
            $winner = $finished ? match (true) {
                $resolution->aHpAfter <= 0 && $resolution->bHpAfter <= 0 => 'draw',
                $resolution->aHpAfter <= 0 => 'b',
                default => 'a',
            } : null;

            // Combat is otherwise the only reliably positive source of gold —
            // buy/sell prices are both randomized around the same base, so
            // trading alone is closer to a coin flip than an income stream.
            $lootGold = null;
            $lootOfferId = null;
            if ($winner === 'a') {
                $lootGold = $this->rollLoot($abordage->bot_ship_type);
                $abordage->user()->increment('coins', $lootGold);

                $items = $this->generateBotCargo($this->botTierIndex($abordage->bot_ship_type));
                if ($items !== []) {
                    $lootOfferId = LootOffer::create([
                        'user_id' => $abordage->user_id,
                        'items' => $items,
                        'status' => 'pending',
                        'expires_at' => now()->addMinutes(5),
                    ])->id;
                }
            }

            $crewBefore = null;
            $crewAfter = null;
            if ($finished) {
                // Win or lose, this is what actually breaks the "hire once,
                // dominate forever" loop — see Ship::applyCasualties. Counts
                // captured around it so the result screen can actually show
                // what the fight cost, not just imply it happened somewhere.
                $ship = $abordage->user->ship()->with('sailors')->first();
                $crewBefore = $ship?->sailorCount();
                $ship?->applyCasualties(max(0, $resolution->aHpAfter) / $abordage->a_max_hp);
                $crewAfter = $ship?->sailorCount();
            }

            $abordage->update([
                'a_hp' => $resolution->aHpAfter,
                'b_hp' => $resolution->bHpAfter,
                'status' => $finished ? 'completed' : 'in_progress',
                'winner' => $winner,
                'loot_gold' => $lootGold,
                'loot_offer_id' => $lootOfferId,
                'finished_at' => $finished ? now() : null,
                'a_crew_before' => $crewBefore,
                'a_crew_after' => $crewAfter,
            ]);

            return $round;
        });
    }

    private function generateBotCargo(int $tier): array
    {
        $types = self::PRODUCT_TYPES;
        shuffle($types);
        $productCount = random_int(2, 4);
        $lossFraction = self::LOOT_LOSS_MIN + (mt_rand() / mt_getrandmax()) * (self::LOOT_LOSS_MAX - self::LOOT_LOSS_MIN);
        $survivalFraction = 1 - $lossFraction;

        $items = [];
        foreach (array_slice($types, 0, $productCount) as $type) {
            $fullAmount = random_int(5, 20) * ($tier + 1);
            $survived = (int) round($fullAmount * $survivalFraction);
            if ($survived > 0) {
                $items[$type] = $survived;
            }
        }

        return $items;
    }

    private function rollLoot(?string $botShipType): int
    {
        $tier = $this->botTierIndex($botShipType);

        return random_int(50, 150) * ($tier + 1);
    }

    private function botTierIndex(?string $botShipType): int
    {
        $tiers = ['boat', 'schooner', 'caravel', 'brig', 'frigate', 'galleon', 'corvette', 'battleship'];
        $index = array_search($botShipType, $tiers, true);

        return $index === false ? 0 : $index;
    }

    private function randomMove(): Move
    {
        $zones = Zone::all();
        shuffle($zones);

        return new Move($zones[0], [$zones[1], $zones[2]]);
    }
}
