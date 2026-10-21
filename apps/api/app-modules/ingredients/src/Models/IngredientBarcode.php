<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Services\IngredientBarcodeService;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * "In this kitchen, this GTIN is this ingredient, and one scan of it is this
 * much." Written only by {@see IngredientBarcodeService}.
 *
 * @property string $id
 * @property string $organisation_id always the kitchen's own row, even when the ingredient is a platform one
 * @property string $ingredient_id
 * @property string $gtin fourteen digits, left-zero-padded
 * @property string $origin supplier | system
 * @property numeric-string|null $pack_quantity
 * @property string|null $pack_unit_id
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'gtin')]
class IngredientBarcode extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** The producer's code, printed on the pack. */
    public const string ORIGIN_SUPPLIER = 'supplier';

    /** A kitchen code: a GS1 Restricted Circulation Number this kitchen minted. */
    public const string ORIGIN_SYSTEM = 'system';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['pack_quantity' => 'decimal:4'];
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }

    /**
     * @return BelongsTo<MeasurementUnit, $this>
     */
    public function packUnit(): BelongsTo
    {
        return $this->belongsTo(MeasurementUnit::class, 'pack_unit_id');
    }
}
