<?php

namespace App\Services\Abordage;

class BattleEngine
{
    // Matches the original's crit bonus (Attack(): _damag + damag/100*30).
    private const CRIT_MULTIPLIER = 1.3;

    /**
     * Captain stats (see Ship::captainStats) now actually decide combat:
     * dodge can avoid a hit outright, defense reduces a blocked hit,
     * critical can boost it — the original Captain.cs fields, wired up for
     * real instead of sitting unused behind a flat 30/15 swing. Dodge/crit
     * are rolled independently per attack (not gated behind a null move —
     * you can still flinch out of the way even if you forgot to pick a
     * defend zone that round), but the zone-block reduction only applies
     * when a defend move was actually submitted.
     */
    public function resolveRound(
        int $round,
        int $aHp,
        int $bHp,
        ?Move $aMove,
        ?Move $bMove,
        CaptainStats $aStats,
        CaptainStats $bStats,
    ): RoundResolution {
        $bOutcome = $aMove === null ? null : $this->rollAttack($aStats, $bStats, $aMove->attack, $bMove);
        $aOutcome = $bMove === null ? null : $this->rollAttack($bStats, $aStats, $bMove->attack, $aMove);

        $bDamage = $bOutcome->damage ?? 0;
        $aDamage = $aOutcome->damage ?? 0;

        $bHpAfter = max(0, $bHp - $bDamage);
        $aHpAfter = max(0, $aHp - $aDamage);

        $text = sprintf(
            "Раунд %d: A %s. B %s.\n".
            '→ Удар A %s — B теряет %d HP (%d осталось)'."\n".
            '→ Удар B %s — A теряет %d HP (%d осталось)',
            $round,
            $this->describeMove($aMove),
            $this->describeMove($bMove),
            $this->describeOutcome($aMove, $bOutcome), $bDamage, $bHpAfter,
            $this->describeOutcome($bMove, $aOutcome), $aDamage, $aHpAfter,
        );

        // aOutcome describes the hit A received (from B's attack) — that's
        // "was A's incoming hit blocked", i.e. aBlocked, not bOutcome's.
        return new RoundResolution($aDamage, $bDamage, $aOutcome?->blocked ?? false, $bOutcome?->blocked ?? false, $aHpAfter, $bHpAfter, $text);
    }

    /**
     * @param  CaptainStats  $attackerStats  whoever is dealing this hit
     * @param  CaptainStats  $defenderStats  whoever is receiving it
     * @param  Zone  $attackZone  the attacker's chosen target zone
     * @param  ?Move  $defenderMove  the defender's own move this round — null means nothing was chosen to block with
     */
    private function rollAttack(CaptainStats $attackerStats, CaptainStats $defenderStats, Zone $attackZone, ?Move $defenderMove): AttackOutcome
    {
        if (random_int(0, 99) < $defenderStats->dodge) {
            return new AttackOutcome(0, false, true);
        }

        $damage = $attackerStats->damage;
        if (random_int(0, 99) < $attackerStats->crit) {
            $damage = (int) round($damage * self::CRIT_MULTIPLIER);
        }

        $blocked = $defenderMove !== null && $defenderMove->defends($attackZone);
        if ($blocked) {
            $damage = max(0, $damage - (int) floor($damage * $defenderStats->defense / 100));
        }

        return new AttackOutcome($damage, $blocked, false);
    }

    private function describeMove(?Move $move): string
    {
        if ($move === null) {
            return 'не успел сходить (не бил и не защищался)';
        }

        return sprintf(
            'бьёт в %s, защищает %s и %s',
            $move->attack->label(), $move->defend[0]->label(), $move->defend[1]->label(),
        );
    }

    private function describeOutcome(?Move $attackerMove, ?AttackOutcome $outcome): string
    {
        if ($attackerMove === null) {
            return 'не бил';
        }
        if ($outcome->dodged) {
            return 'уворот!';
        }
        if ($outcome->blocked) {
            return 'заблокирован';
        }

        return 'проходит';
    }
}
