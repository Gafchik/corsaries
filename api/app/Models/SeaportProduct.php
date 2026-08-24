<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['seaport_id', 'type', 'price', 'stock'])]
class SeaportProduct extends Model
{
    public function seaport(): BelongsTo
    {
        return $this->belongsTo(Seaport::class);
    }
}
