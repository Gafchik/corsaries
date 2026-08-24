<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Abordage extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'finished_at' => 'datetime',
            'round_deadline_at' => 'datetime',
            'a_pending_defend' => 'array',
            'b_pending_defend' => 'array',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function opponent(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opponent_user_id');
    }

    public function rounds(): HasMany
    {
        return $this->hasMany(AbordageRound::class);
    }
}
