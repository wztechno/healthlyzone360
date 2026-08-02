<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Models;

use Carbon\CarbonImmutable;
use Healthy360\Allergens\Database\Factories\AllergenFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * A canonical allergen class.
 *
 * Keyed on `code`, not on a UUID — the justified exception recorded in the
 * migration docblock. `BaseModel` brings `HasUuidV7Key`; `uniqueIds()` is
 * emptied so nothing generates a key here. The code arrives with the
 * reference data and is the identity, so generating one would overwrite the
 * only thing about this row that matters.
 *
 * Public classification: this is the one part of the catalogue anonymous
 * callers read in full. Names, descriptions and market metadata are exactly
 * what a diner needs to see.
 *
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property string|null $description_en
 * @property string|null $description_ar
 * @property string $regulatory_ref
 * @property bool $is_eu_14
 * @property bool $is_us_big_9
 * @property bool $us_declaration_required
 * @property int|null $us_threshold_ppm
 * @property int $display_order
 * @property bool $is_active
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'code', 'name_en', 'name_ar', 'description_en', 'description_ar', 'regulatory_ref')]
class Allergen extends BaseModel
{
    /** @use HasFactory<AllergenFactory> */
    use HasFactory;

    protected $table = 'allergens';

    protected $primaryKey = 'code';

    public $incrementing = false;

    protected $keyType = 'string';

    /**
     * No column here is application-generated.
     *
     * @return array<int, string>
     */
    public function uniqueIds(): array
    {
        return [];
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_eu_14' => 'boolean',
            'is_us_big_9' => 'boolean',
            'us_declaration_required' => 'boolean',
            'is_active' => 'boolean',
            'us_threshold_ppm' => 'integer',
            'display_order' => 'integer',
        ];
    }
}
