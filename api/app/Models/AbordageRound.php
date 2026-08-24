<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AbordageRound extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'a_defend' => 'array',
            'b_defend' => 'array',
            'a_blocked' => 'boolean',
            'b_blocked' => 'boolean',
        ];
    }

    public function abordage(): BelongsTo
    {
        return $this->belongsTo(Abordage::class);
    }
}
