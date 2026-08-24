<?php

namespace App\Services\Abordage;

readonly class CaptainStats
{
    public function __construct(
        public int $damage,
        public int $defense,
        public int $dodge,
        public int $crit,
    ) {
    }

    public static function fromArray(array $stats): self
    {
        return new self($stats['damage'], $stats['defense'], $stats['dodge'], $stats['crit']);
    }
}
