<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $organisation_id
 * @property string $code
 * @property string $name_en
 * @property string|null $name_ar
 * @property string|null $currency_code
 * @property string|null $contact_email
 * @property string|null $contact_phone
 * @property string|null $address
 * @property string|null $payment_terms
 * @property int|null $lead_time_days
 * @property string|null $notes
 * @property CarbonImmutable|null $archived_at
 * @property-read Collection<int, SupplierContact> $contacts
 * @property-read Collection<int, SupplierStockItem> $suppliedItems
 */
class Supplier extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'lead_time_days' => 'integer',
            'archived_at' => 'datetime',
        ];
    }

    /**
     * The named people at this supplier, in the kitchen's own order.
     *
     * `display_order` first and `name` as the tie-break, so a set saved with
     * every order at 0 — which is what an editor that never reordered
     * produces — still comes back the same way twice.
     *
     * @return HasMany<SupplierContact, $this>
     */
    public function contacts(): HasMany
    {
        return $this->hasMany(SupplierContact::class)
            ->orderBy('display_order')
            ->orderBy('name');
    }

    /**
     * What this supplier sells this kitchen (§3.3).
     *
     * Ordered so the preferred link comes first and the rest follow their
     * shelf's name — a supplied-items table wants the item you would actually
     * order from them at the top, and a set saved in any order still comes back
     * the same way twice. The join is what lets the name sort happen in SQL
     * rather than over a collection the presenter would have to re-sort.
     *
     * @return HasMany<SupplierStockItem, $this>
     */
    public function suppliedItems(): HasMany
    {
        return $this->hasMany(SupplierStockItem::class)
            ->join('stock_items', 'stock_items.id', '=', 'supplier_stock_items.stock_item_id')
            ->orderByDesc('supplier_stock_items.is_preferred')
            ->orderBy('stock_items.name_en')
            ->select('supplier_stock_items.*');
    }

    /**
     * The live book — every picker, list and suggestion reads through this.
     *
     * Matches the partial index the migration adds, so it is the cheap read
     * rather than a filter over the whole table.
     *
     * @param  Builder<static>  $query
     */
    public function scopeNotArchived(Builder $query): void
    {
        $query->whereNull('archived_at');
    }

    public function isArchived(): bool
    {
        return $this->archived_at !== null;
    }
}
