<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Ingredients\Enums\IngredientStatus;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One packaging item a pack is made of. See the table's migration.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_variant_id
 * @property string $ingredient_id
 * @property numeric-string $quantity
 * @property bool $is_container
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'quantity', 'is_container')]
class CatalogueItemPackComponent extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'is_container' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class, 'catalogue_item_variant_id');
    }

    /**
     * The usable packaging items among the given identifiers, keyed by id —
     * active, filed under the packaging branch, and visible to the current
     * organisation. The same test a recipe's packaging line passes
     * (`RecipeVersionService::usablePackagingItem`), asked here so the pricing
     * module, which does not depend on Ingredients, need not ask it itself.
     *
     * @param  list<string>  $ids
     * @return array<string, Ingredient>
     */
    public static function usablePackaging(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return Ingredient::query()
            ->onlyPackaging()
            ->whereIn('id', array_values(array_unique($ids)))
            ->where('status', IngredientStatus::Active->value)
            ->get()
            ->keyBy(static fn (Ingredient $item): string => (string) $item->getKey())
            ->all();
    }
}
