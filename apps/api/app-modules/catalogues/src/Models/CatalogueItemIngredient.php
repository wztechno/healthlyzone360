<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\CatalogueItemIngredientFactory;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What a catalogue item is made of, as a customer is told it.
 *
 * **Not a formulation** — there are no quantities here and there will not be.
 * A recipe version's lines are the formulation, they are confidential, and a
 * table carrying both a public ingredient list and a quantity would be one
 * careless presenter away from publishing a competitor's shopping list.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_id
 * @property string $ingredient_id
 * @property bool $is_representative
 * @property int $display_order
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'is_representative', 'display_order')]
class CatalogueItemIngredient extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<CatalogueItemIngredientFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_representative' => 'boolean',
            'display_order' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return BelongsTo<Ingredient, $this>
     */
    public function ingredient(): BelongsTo
    {
        return $this->belongsTo(Ingredient::class);
    }
}
