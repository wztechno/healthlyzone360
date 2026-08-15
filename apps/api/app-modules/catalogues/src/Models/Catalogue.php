<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Database\Factories\CatalogueFactory;
use Healthy360\Catalogues\Enums\CatalogueStatus;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The container an organisation's sellable items belong to.
 *
 * Thin by design: everything interesting is on the items. The catalogue
 * exists so a kitchen can hold more than one range at a time — a summer menu
 * drafted beside the live one, a branch-specific list — without that meaning
 * duplicating every item's identity.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string|null $branch_id
 * @property string $code
 * @property string $name_en
 * @property string $name_ar
 * @property CatalogueStatus $status
 * @property string|null $created_by
 * @property string|null $updated_by
 * @property int $lock_version
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Internal, 'code', 'name_en', 'name_ar')]
class Catalogue extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<CatalogueFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => CatalogueStatus::class,
            'lock_version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }

    /**
     * @return HasMany<CatalogueItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(CatalogueItem::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
