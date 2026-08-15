<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\CatalogueItemDietClassificationFactory;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Which diet patterns an item is sold as. A preference filter, never an
 * allergen statement.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $catalogue_item_id
 * @property string $diet_classification_id
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Public, 'diet_classification_id')]
class CatalogueItemDietClassification extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<CatalogueItemDietClassificationFactory> */
    use HasFactory;

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class, 'catalogue_item_id');
    }

    /**
     * @return BelongsTo<DietClassification, $this>
     */
    public function classification(): BelongsTo
    {
        return $this->belongsTo(DietClassification::class, 'diet_classification_id');
    }
}
