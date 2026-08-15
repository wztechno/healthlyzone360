<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string|null $supplier_id
 * @property string|null $document_ref
 * @property string|null $purchase_order_id
 * @property CarbonImmutable|null $received_at
 */
class GoodsReceipt extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return ['received_at' => 'immutable_datetime'];
    }

    /**
     * @return HasMany<GoodsReceiptLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(GoodsReceiptLine::class);
    }

    /**
     * @return BelongsTo<Supplier, $this>
     */
    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }
}
