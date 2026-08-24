<?php

namespace App\Services\Abordage;

readonly class Move
{
    /**
     * @param  Zone[]  $defend  exactly two distinct zones
     */
    public function __construct(
        public Zone $attack,
        public array $defend,
    ) {
    }

    public function defends(Zone $zone): bool
    {
        foreach ($this->defend as $z) {
            if ($z === $zone) {
                return true;
            }
        }

        return false;
    }
}
