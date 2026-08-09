<?php

declare(strict_types=1);

namespace Healthy360\ReferenceData\Models;

use Healthy360\ReferenceData\Database\Factories\MeasurementUnitFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * Measurement unit used across nutrition and clinical features.
 *
 * @property string $id
 * @property string $code e.g. g, ml, kcal, cm, kg
 * @property string $dimension mass | volume | count | serving | package | energy | length
 * @property string $unit_system metric | imperial | clinical | packaging
 * @property numeric-string $base_ratio factor to the dimension's canonical base (mass=gram, volume=millilitre); 1 for non-convertible dimensions
 * @property string $name_en
 * @property string $name_ar
 * @property bool $is_active
 */
class MeasurementUnit extends BaseModel
{
    /** @use HasFactory<MeasurementUnitFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'base_ratio' => 'decimal:9',
            'is_active' => 'boolean',
        ];
    }
}
