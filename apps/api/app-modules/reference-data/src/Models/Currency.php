<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Models;

use Healthy360\ReferenceData\Database\Factories\CurrencyFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * ISO 4217 currency; the code is the natural primary key.
 *
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property int $minor_units
 * @property bool $is_active
 */
class Currency extends Model
{
    /** @use HasFactory<CurrencyFactory> */
    use HasFactory;

    protected $primaryKey = 'code';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /**
     * @var array<string>
     */
    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'minor_units' => 'integer',
            'is_active' => 'boolean',
        ];
    }
}
