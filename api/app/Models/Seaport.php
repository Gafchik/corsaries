<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Seaport extends Model
{
    protected $guarded = [];

    public function products(): HasMany
    {
        return $this->hasMany(SeaportProduct::class);
    }
}
