<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What arrived, from whom, and what it cost (§3.6).
 *
 * **Two dates, and they are two different facts.** `received_at` is the exact
 * instant, in UTC. `received_on` is the branch-local calendar day the delivery
 * belongs to, and it is what §3.7 groups spend by — a van unloaded at 21:30 in
 * Dubai is a Tuesday delivery, and reading the UTC instant's date would file it
 * on Monday.
 *
 * **Two document references, likewise.** `document_ref` is the delivery note the
 * driver handed over; `supplier_invoice_ref` and `invoice_date` are the invoice,
 * which often arrives days later. A receipt may legitimately have the first and
 * not the second — that is the whole reason the **Unpriced receipts** queue
 * exists.
 *
 * `cost_status` is derived, never set by hand: a line counts as settled when it
 * carries `costed_at`, and the receipt is `complete` when every line does. The
 * header charges are in the receipt's **line** currency; there is deliberately
 * no currency column of their own, because a second one could disagree with the
 * lines and §3.6 forbids the state that would express.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string|null $supplier_id
 * @property string|null $document_ref
 * @property string|null $supplier_invoice_ref
 * @property CarbonImmutable|null $invoice_date
 * @property string|null $variance_note why this delivery differs from what was ordered (§4)
 * @property string|null $purchase_order_id
 * @property CarbonImmutable|null $received_at
 * @property CarbonImmutable|null $received_on the branch-local business date (§3.6)
 * @property string $cost_status one of unpriced|partial|complete, derived from the lines
 * @property numeric-string|null $discount_amount
 * @property numeric-string|null $tax_amount
 * @property numeric-string|null $delivery_amount
 * @property numeric-string|null $other_charges_amount
 * @property numeric-string|null $invoice_total_amount
 * @property CarbonImmutable|null $created_at
 * @property-read Collection<int, GoodsReceiptLine> $lines
 * @property-read Supplier|null $supplier
 * @property-read PurchaseOrder|null $purchaseOrder
 */
class GoodsReceipt extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'received_at' => 'immutable_datetime',
            // `immutable_date` rather than `immutable_datetime`: this is a
            // calendar day, and a midnight time component on it would invite a
            // timezone shift into the one column that exists to avoid exactly
            // that.
            'received_on' => 'immutable_date',
            'invoice_date' => 'immutable_date',
            'discount_amount' => 'decimal:6',
            'tax_amount' => 'decimal:6',
            'delivery_amount' => 'decimal:6',
            'other_charges_amount' => 'decimal:6',
            'invoice_total_amount' => 'decimal:6',
        ];
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

    /**
     * The order this delivery was made against, when there was one.
     *
     * Null for a direct market purchase, which §3.6 keeps as an ordinary case
     * rather than an exception.
     *
     * @return BelongsTo<PurchaseOrder, $this>
     */
    public function purchaseOrder(): BelongsTo
    {
        return $this->belongsTo(PurchaseOrder::class);
    }
}
