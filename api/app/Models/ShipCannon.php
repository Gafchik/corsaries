<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['ship_id', 'slot', 'level'])]
class ShipCannon extends Model
{
    public function ship(): BelongsTo
    {
        return $this->belongsTo(Ship::class);
    }
}
