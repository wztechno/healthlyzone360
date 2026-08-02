<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\ProductCategoryFactory;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * How a kitchen files what it sells. Rows with `organisation_id` NULL are the
 * platform library and stay visible in every tenant context — the `roles`
 * pattern, shared with `ingredient_categories`.
 *
 * Deliberately *not* the ingredient taxonomy: that one is purchasing-shaped
 * ("where does this raw material live in the store cupboard"), this one is
 * merchandising-shaped ("which shelf of the shop is this on"). They agree
 * today and will not agree for long.
 *
 * @property string $id
 * @property string|null $organisation_id null = platform library
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property int $display_order
 * @property bool $is_active
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'code', 'name_en', 'name_ar')]
class ProductCategory extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<ProductCategoryFactory> */
    use HasFactory;

    public function organisationScopeAllowsNull(): bool
    {
        return true;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'display_order' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isPlatformRow(): bool
    {
        return $this->organisation_id === null;
    }
}
