<?php

namespace App\Services\Abordage;

enum Zone: string
{
    case Head = 'head';
    case Chest = 'chest';
    case Groin = 'groin';
    case Legs = 'legs';

    public static function all(): array
    {
        return [self::Head, self::Chest, self::Groin, self::Legs];
    }

    public function label(): string
    {
        return match ($this) {
            self::Head => 'голову',
            self::Chest => 'грудь',
            self::Groin => 'пах',
            self::Legs => 'ноги',
        };
    }
}
