<?php

namespace App\Http\Controllers;

use App\Models\Abordage;
use App\Models\User;
use App\Services\Abordage\AbordagePveService;
use App\Services\Abordage\AbordagePvpService;
use App\Services\Abordage\Move;
use App\Services\Abordage\Zone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AbordageController extends Controller
{
    // Captain stats (see Ship::captainStats) alongside HP — the original's
    // UI showed both captains' damage/deff/dodge/crit throughout the fight,
    // not just HP bars.
    private const ABORDAGE_FIELDS = [
        'id', 'a_hp', 'a_max_hp', 'a_damage', 'a_defense', 'a_dodge', 'a_crit',
        'b_hp', 'b_max_hp', 'b_damage', 'b_defense', 'b_dodge', 'b_crit', 'status',
        // Null until the fight ends (see Ship::applyCasualties) — b_* stays
        // null forever in PvE, a bot has no real crew to have lost.
        'a_crew_before', 'a_crew_after', 'b_crew_before', 'b_crew_after',
    ];

    public function __construct(
        private readonly AbordagePveService $pve,
        private readonly AbordagePvpService $pvp,
    ) {
    }

    public function startPve(Request $request): JsonResponse
    {
        $data = $request->validate(['bot_ship_type' => ['nullable', 'string']]);

        $abordage = $this->pve->start($request->user(), $data['bot_ship_type'] ?? null);

        return response()->json(['abordage' => $abordage->only(self::ABORDAGE_FIELDS)]);
    }

    /**
     * Called by the realtime service using the challenger's own token — not
     * a separate internal auth mechanism, just a normal authenticated
     * request made on their behalf once WorldRoom.js has already confirmed
     * both players are close enough. See DECK 05 "where services meet".
     */
    public function startPvp(Request $request): JsonResponse
    {
        $data = $request->validate(['opponent_user_id' => ['required', 'integer', 'exists:users,id']]);

        if ((int) $data['opponent_user_id'] === $request->user()->id) {
            return response()->json(['error' => ['message' => 'Cannot duel yourself']], 400);
        }

        $opponent = User::findOrFail($data['opponent_user_id']);
        $abordage = $this->pvp->create($request->user(), $opponent);

        return response()->json(['abordage' => $abordage->only(self::ABORDAGE_FIELDS)]);
    }

    public function show(Request $request, int $abordageId): JsonResponse
    {
        $abordage = $this->findForUser($request, $abordageId);

        if ($abordage === null) {
            return response()->json(['error' => ['message' => 'Abordage not found']], 404);
        }

        if ($abordage->mode === 'pvp') {
            $abordage = $this->pvp->resolveIfTimedOut($abordage);
        }

        $rounds = $abordage->rounds()->orderBy('round')->get([
            'round', 'a_attack', 'a_defend', 'b_attack', 'b_defend', 'a_damage', 'b_damage', 'a_blocked', 'b_blocked', 'a_hp_after', 'b_hp_after', 'text',
        ]);

        return response()->json([
            'abordage' => array_merge(
                $abordage->only([...self::ABORDAGE_FIELDS, 'mode', 'winner', 'loot_gold', 'loot_offer_id']),
                $this->pvpMeta($request, $abordage),
            ),
            'rounds' => $rounds,
        ]);
    }

    public function move(Request $request, int $abordageId): JsonResponse
    {
        $data = $request->validate([
            'attack' => ['required', 'string', 'in:head,chest,groin,legs'],
            'defend' => ['required', 'array', 'size:2'],
            'defend.*' => ['string', 'in:head,chest,groin,legs', 'distinct'],
        ]);

        $abordage = $this->findForUser($request, $abordageId);

        if ($abordage === null) {
            return response()->json(['error' => ['message' => 'Abordage not found']], 404);
        }

        $move = new Move(
            Zone::from($data['attack']),
            array_map(fn ($z) => Zone::from($z), $data['defend']),
        );

        try {
            if ($abordage->mode === 'pvp') {
                $abordage = $this->pvp->submitMove($abordage, $request->user(), $move);

                return response()->json([
                    'abordage' => array_merge(
                        $abordage->only([...self::ABORDAGE_FIELDS, 'winner', 'loot_gold', 'loot_offer_id']),
                        $this->pvpMeta($request, $abordage),
                    ),
                ]);
            }

            $round = $this->pve->submitMove($abordage, $move);

            return response()->json([
                'round' => $round->only(['round', 'a_attack', 'a_defend', 'b_attack', 'b_defend', 'a_damage', 'b_damage', 'a_blocked', 'b_blocked', 'a_hp_after', 'b_hp_after', 'text']),
                'abordage' => $abordage->fresh()->only([...self::ABORDAGE_FIELDS, 'winner', 'loot_gold', 'loot_offer_id']),
            ]);
        } catch (\RuntimeException $e) {
            return response()->json(['error' => ['message' => $e->getMessage()]], 400);
        }
    }

    private function findForUser(Request $request, int $abordageId): ?Abordage
    {
        return Abordage::where('id', $abordageId)
            ->where(fn ($q) => $q->where('user_id', $request->user()->id)->orWhere('opponent_user_id', $request->user()->id))
            ->first();
    }

    /** @return array{your_side?: string, my_pending_submitted?: bool, round_deadline_at?: ?string, opponent?: ?array} */
    private function pvpMeta(Request $request, Abordage $abordage): array
    {
        if ($abordage->mode !== 'pvp') {
            return [];
        }

        $side = $request->user()->id === $abordage->user_id ? 'a' : 'b';
        $opponentId = $side === 'a' ? $abordage->opponent_user_id : $abordage->user_id;
        $opponent = User::query()->where('id', $opponentId)->first(['first_name', 'username', 'photo_url']);

        return [
            'your_side' => $side,
            'my_pending_submitted' => $abordage->{"{$side}_pending_attack"} !== null,
            'round_deadline_at' => $abordage->round_deadline_at,
            'opponent' => $opponent,
        ];
    }
}
