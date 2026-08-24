<?php

namespace App\Services\Abordage;

use App\Models\Abordage;
use App\Models\AbordageRound;
use App\Models\LootOffer;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Same async round-exchange shape as battle-arena's PvpBattleService: both
 * sides submit independently, the room resolves the instant both are in
 * (or on timeout, lazily, whenever either side next polls/acts). The only
 * real difference from that service is that there's no waiting_for_opponent
 * phase here — WorldRoom.js already confirmed both players are present
 * before creating this row, so it starts straight into in_progress.
 */
class AbordagePvpService
{
    private const ROUND_TIMEOUT_SECONDS = 60;
    private const BASE_CAPTAIN_HP = 20;
    // Same "sinking isn't vanishing" framing as naval combat's LOOT_LOSS —
    // this is how much of the loser's hold is lost in the boarding, not how
    // much survives to be plundered.
    private const LOOT_LOSS_MIN = 0.15;
    private const LOOT_LOSS_MAX = 0.35;
    private const GOLD_STEAL_FRACTION = 0.15; // a cut, not a wipeout

    public function __construct(
        private readonly BattleEngine $engine,
    ) {
    }

    public function create(User $challenger, User $opponent): Abordage
    {
        $aStats = $this->captainStats($challenger);
        $bStats = $this->captainStats($opponent);

        return Abordage::create([
            'user_id' => $challenger->id,
            'opponent_user_id' => $opponent->id,
            'mode' => 'pvp',
            'a_hp' => $aStats['hp'],
            'a_max_hp' => $aStats['hp'],
            'a_damage' => $aStats['damage'],
            'a_defense' => $aStats['defense'],
            'a_dodge' => $aStats['dodge'],
            'a_crit' => $aStats['crit'],
            'b_hp' => $bStats['hp'],
            'b_max_hp' => $bStats['hp'],
            'b_damage' => $bStats['damage'],
            'b_defense' => $bStats['defense'],
            'b_dodge' => $bStats['dodge'],
            'b_crit' => $bStats['crit'],
            'status' => 'in_progress',
            'round_deadline_at' => now()->addSeconds(self::ROUND_TIMEOUT_SECONDS),
        ]);
    }

    public function submitMove(Abordage $abordage, User $user, Move $move): Abordage
    {
        $abordage = $this->resolveIfTimedOut($abordage);

        if ($abordage->status !== 'in_progress') {
            throw new \RuntimeException('Этот абордаж уже завершён.');
        }

        $side = match ($user->id) {
            $abordage->user_id => 'a',
            $abordage->opponent_user_id => 'b',
            default => throw new \RuntimeException('Ты не участвуешь в этом абордаже.'),
        };

        $abordage->update([
            "{$side}_pending_attack" => $move->attack->value,
            "{$side}_pending_defend" => array_map(fn (Zone $z) => $z->value, $move->defend),
        ]);
        $abordage->refresh();

        $aMove = $this->moveFromPending($abordage, 'a');
        $bMove = $this->moveFromPending($abordage, 'b');

        if ($aMove !== null && $bMove !== null) {
            $abordage = $this->resolveRound($abordage, $aMove, $bMove);
        }

        return $abordage;
    }

    /** Called on every GET too, so a passive player still sees the round resolve once the deadline passes. */
    public function resolveIfTimedOut(Abordage $abordage): Abordage
    {
        if ($abordage->status !== 'in_progress' || $abordage->round_deadline_at === null) {
            return $abordage;
        }
        if (now()->lessThan($abordage->round_deadline_at)) {
            return $abordage;
        }

        return $this->resolveRound($abordage, $this->moveFromPending($abordage, 'a'), $this->moveFromPending($abordage, 'b'));
    }

    private function captainStats(User $user): array
    {
        $ship = $user->ship()->with('sailors')->first();
        if ($ship === null) {
            return ['hp' => self::BASE_CAPTAIN_HP, 'damage' => 5, 'defense' => 0, 'dodge' => 0, 'crit' => 0];
        }

        return $ship->captainStats();
    }

    /**
     * Both captains are real ships in PvP, unlike PvE where only the human
     * side has a crew to lose — see Ship::applyCasualties for why this
     * exists at all (a hired crew was otherwise a one-time purchase with no
     * ongoing risk).
     */
    /**
     * @return array{a_crew_before: ?int, a_crew_after: ?int, b_crew_before: ?int, b_crew_after: ?int}
     */
    private function applyCasualties(Abordage $abordage, float $aSurvivalFraction, float $bSurvivalFraction): array
    {
        $aShip = User::find($abordage->user_id)?->ship()->with('sailors')->first();
        $aBefore = $aShip?->sailorCount();
        $aShip?->applyCasualties($aSurvivalFraction);

        $bShip = User::find($abordage->opponent_user_id)?->ship()->with('sailors')->first();
        $bBefore = $bShip?->sailorCount();
        $bShip?->applyCasualties($bSurvivalFraction);

        return [
            'a_crew_before' => $aBefore,
            'a_crew_after' => $aShip?->sailorCount(),
            'b_crew_before' => $bBefore,
            'b_crew_after' => $bShip?->sailorCount(),
        ];
    }

    private function moveFromPending(Abordage $abordage, string $side): ?Move
    {
        $attack = $abordage->{"{$side}_pending_attack"};
        $defend = $abordage->{"{$side}_pending_defend"};

        if ($attack === null || $defend === null || count($defend) !== 2) {
            return null;
        }

        return new Move(Zone::from($attack), array_map(fn ($z) => Zone::from($z), $defend));
    }

    private function resolveRound(Abordage $abordage, ?Move $aMove, ?Move $bMove): Abordage
    {
        $roundNumber = $abordage->rounds()->count() + 1;
        $aStats = new CaptainStats($abordage->a_damage, $abordage->a_defense, $abordage->a_dodge, $abordage->a_crit);
        $bStats = new CaptainStats($abordage->b_damage, $abordage->b_defense, $abordage->b_dodge, $abordage->b_crit);

        // Mutual timeout: both forfeit regardless of HP, same rule as the naval PvP.
        if ($aMove === null && $bMove === null) {
            $resolution = $this->engine->resolveRound($roundNumber, $abordage->a_hp, $abordage->b_hp, null, null, $aStats, $bStats);

            return DB::transaction(function () use ($abordage, $roundNumber, $resolution) {
                $this->persistRound($abordage->id, $roundNumber, null, null, $resolution);
                $crew = $this->applyCasualties($abordage, $abordage->a_hp / $abordage->a_max_hp, $abordage->b_hp / $abordage->b_max_hp);
                $abordage->update([
                    'status' => 'completed',
                    'winner' => 'draw',
                    'finished_at' => now(),
                    'a_pending_attack' => null, 'a_pending_defend' => null,
                    'b_pending_attack' => null, 'b_pending_defend' => null,
                    'round_deadline_at' => null,
                    ...$crew,
                ]);

                return $abordage->fresh();
            });
        }

        $resolution = $this->engine->resolveRound($roundNumber, $abordage->a_hp, $abordage->b_hp, $aMove, $bMove, $aStats, $bStats);
        $finished = $resolution->aHpAfter <= 0 || $resolution->bHpAfter <= 0;
        $winner = $finished ? match (true) {
            $resolution->aHpAfter <= 0 && $resolution->bHpAfter <= 0 => 'draw',
            $resolution->aHpAfter <= 0 => 'b',
            default => 'a',
        } : null;

        return DB::transaction(function () use ($abordage, $roundNumber, $aMove, $bMove, $resolution, $finished, $winner) {
            $this->persistRound($abordage->id, $roundNumber, $aMove, $bMove, $resolution);

            $lootGold = null;
            $lootOfferId = null;
            if ($winner === 'a' || $winner === 'b') {
                $winnerUserId = $winner === 'a' ? $abordage->user_id : $abordage->opponent_user_id;
                $loserUserId = $winner === 'a' ? $abordage->opponent_user_id : $abordage->user_id;
                [$lootOfferId, $lootGold] = $this->plunderLoser($winnerUserId, $loserUserId);
            }

            $crew = [];
            if ($finished) {
                $crew = $this->applyCasualties(
                    $abordage,
                    max(0, $resolution->aHpAfter) / $abordage->a_max_hp,
                    max(0, $resolution->bHpAfter) / $abordage->b_max_hp,
                );
            }

            $abordage->update([
                'a_hp' => $resolution->aHpAfter,
                'b_hp' => $resolution->bHpAfter,
                'status' => $finished ? 'completed' : 'in_progress',
                'winner' => $winner,
                'loot_gold' => $lootGold,
                'loot_offer_id' => $lootOfferId,
                'finished_at' => $finished ? now() : null,
                'a_pending_attack' => null, 'a_pending_defend' => null,
                'b_pending_attack' => null, 'b_pending_defend' => null,
                'round_deadline_at' => $finished ? null : now()->addSeconds(self::ROUND_TIMEOUT_SECONDS),
                ...$crew,
            ]);

            return $abordage->fresh();
        });
    }

    /**
     * Winning a boarding fight was gold-only before, and PvP wasn't even
     * that — no reward at all. Now the winner gets a LootOffer built from a
     * survival-fraction slice of the loser's *real* cargo (same idea as a
     * sunk ship's hold, see AbordagePveService/WorldRoom.js's
     * generateBotCargo), plus a modest cut of their gold. The loser's own
     * ship really does lose that cargo/gold — boarding has stakes.
     *
     * @return array{0: ?int, 1: ?int} [lootOfferId, goldStolen]
     */
    private function plunderLoser(int $winnerUserId, int $loserUserId): array
    {
        $loserShip = User::find($loserUserId)?->ship()->with('products')->first();
        $lootOfferId = null;

        if ($loserShip !== null) {
            $lossFraction = self::LOOT_LOSS_MIN + (mt_rand() / mt_getrandmax()) * (self::LOOT_LOSS_MAX - self::LOOT_LOSS_MIN);
            $survivalFraction = 1 - $lossFraction;

            $items = [];
            foreach ($loserShip->products as $product) {
                $taken = (int) round($product->quantity * $survivalFraction);
                if ($taken <= 0) {
                    continue;
                }
                $items[$product->type] = $taken;
                $product->decrement('quantity', $taken);
            }

            if ($items !== []) {
                $lootOfferId = LootOffer::create([
                    'user_id' => $winnerUserId,
                    'items' => $items,
                    'status' => 'pending',
                    'expires_at' => now()->addMinutes(5),
                ])->id;
            }
        }

        $goldStolen = 0;
        $loserUser = User::find($loserUserId);
        if ($loserUser !== null && $loserUser->coins > 0) {
            $goldStolen = (int) round($loserUser->coins * self::GOLD_STEAL_FRACTION);
            if ($goldStolen > 0) {
                $loserUser->decrement('coins', $goldStolen);
                User::find($winnerUserId)?->increment('coins', $goldStolen);
            }
        }

        return [$lootOfferId, $goldStolen > 0 ? $goldStolen : null];
    }

    private function persistRound(int $abordageId, int $round, ?Move $aMove, ?Move $bMove, RoundResolution $resolution): void
    {
        AbordageRound::create([
            'abordage_id' => $abordageId,
            'round' => $round,
            'a_attack' => $aMove?->attack->value,
            'a_defend' => $aMove === null ? null : array_map(fn (Zone $z) => $z->value, $aMove->defend),
            'b_attack' => $bMove?->attack->value,
            'b_defend' => $bMove === null ? null : array_map(fn (Zone $z) => $z->value, $bMove->defend),
            'a_damage' => $resolution->aDamage,
            'b_damage' => $resolution->bDamage,
            'a_blocked' => $resolution->aBlocked,
            'b_blocked' => $resolution->bBlocked,
            'a_hp_after' => $resolution->aHpAfter,
            'b_hp_after' => $resolution->bHpAfter,
            'text' => $resolution->text,
        ]);
    }
}
