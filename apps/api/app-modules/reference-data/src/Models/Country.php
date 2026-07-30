<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Models;

use Healthy360\ReferenceData\Database\Factories\CountryFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * ISO 3166-1 alpha-2 country; all countries are seeded but only launch
 * markets are active.
 *
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $default_currency_code
 * @property bool $is_active
 */
class Country extends Model
{
    /** @use HasFactory<CountryFactory> */
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
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Currency, $this>
     */
    public function defaultCurrency(): BelongsTo
    {
        return $this->belongsTo(Currency::class, 'default_currency_code', 'code');
    }
}
