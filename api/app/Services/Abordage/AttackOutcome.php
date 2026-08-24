<?php

namespace App\Services\Abordage;

readonly class AttackOutcome
{
    public function __construct(
        public int $damage,
        public bool $blocked,
        public bool $dodged,
    ) {
    }
}
