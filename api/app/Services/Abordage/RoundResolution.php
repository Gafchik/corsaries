<?php

namespace App\Services\Abordage;

readonly class RoundResolution
{
    public function __construct(
        public int $aDamage,
        public int $bDamage,
        public bool $aBlocked,
        public bool $bBlocked,
        public int $aHpAfter,
        public int $bHpAfter,
        public string $text,
    ) {
    }
}
