<?php

declare(strict_types=1);

namespace Healthy360\B2b\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\B2b\Database\Factories\QuotationLineFactory;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One article and quantity on a quotation — see the migration for the
 * paired-nullability rule that governs `unit_amount_minor` and
 * `line_total_minor`.
 *
 * @property string $id
 * @property string $organisation_id the buyer, denormalised from the quotation
 * @property string $quotation_id
 * @property int $line_number
 * @property string $catalogue_item_id
 * @property string|null $catalogue_item_variant_id
 * @property string $quantity
 * @property int|null $unit_amount_minor
 * @property int|null $line_total_minor
 * @property string|null $note
 * @property string|null $created_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
class QuotationLine extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    /** @use HasFactory<QuotationLineFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:4',
            'unit_amount_minor' => 'integer',
            'line_total_minor' => 'integer',
        ];
    }

    public function isPriced(): bool
    {
        return $this->unit_amount_minor !== null;
    }

    /**
     * @return BelongsTo<Quotation, $this>
     */
    public function quotation(): BelongsTo
    {
        return $this->belongsTo(Quotation::class);
    }

    /**
     * @return BelongsTo<CatalogueItem, $this>
     */
    public function catalogueItem(): BelongsTo
    {
        return $this->belongsTo(CatalogueItem::class);
    }

    /**
     * @return BelongsTo<CatalogueItemVariant, $this>
     */
    public function catalogueItemVariant(): BelongsTo
    {
        return $this->belongsTo(CatalogueItemVariant::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
