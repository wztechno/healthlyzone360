<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Models;

use Carbon\CarbonImmutable;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Procurement\Enums\PurchaseOrderStatus;
use Healthy360\Procurement\Services\PurchaseOrderNumbers;
use Healthy360\Support\Models\BaseModel;
use Healthy360\Tenancy\Concerns\BelongsToOrganisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One request the kitchen makes of one supplier, for one branch (§3.5).
 *
 * `number` is the human identifier both sides quote — minted random rather than
 * sequential ({@see PurchaseOrderNumbers}) — and
 * `recipient_snapshot` is who the document was addressed to at the instant it
 * was issued. The snapshot exists because §3.5 draws a line a reprint must not
 * cross: a **draft** preview shows the supplier's current details, and an
 * **issued** reprint shows what the supplier was handed. A supplier that changed
 * address in March must not silently rewrite the February order it is holding.
 *
 * There is no `created_by`. Procurement's tables carry no creator column and
 * this one does not start the habit: provenance lives in the audit log, which is
 * where every other "who did this" question in the module is answered.
 *
 * @property string $id
 * @property string $organisation_id
 * @property string $branch_id
 * @property string $supplier_id
 * @property string $number
 * @property PurchaseOrderStatus $status
 * @property CarbonImmutable|null $issued_at
 * @property CarbonImmutable|null $received_at
 * @property CarbonImmutable|null $closed_at
 * @property CarbonImmutable|null $cancelled_at
 * @property string|null $close_short_reason why the rest was written off (§3.5); only ever set on a `received` order
 * @property string|null $notes
 * @property array<string, mixed>|null $recipient_snapshot
 * @property CarbonImmutable|null $created_at
 * @property-read Collection<int, PurchaseOrderLine> $lines
 * @property-read Collection<int, GoodsReceipt> $goodsReceipts
 * @property-read Supplier|null $supplier
 * @property-read OrganisationBranch|null $branch
 */
class PurchaseOrder extends BaseModel implements OrganisationScoped
{
    use BelongsToOrganisation;

    protected function casts(): array
    {
        return [
            'status' => PurchaseOrderStatus::class,
            'issued_at' => 'immutable_datetime',
            'received_at' => 'immutable_datetime',
            'closed_at' => 'immutable_datetime',
            'cancelled_at' => 'immutable_datetime',
            'recipient_snapshot' => 'array',
        ];
    }

    /**
     * The lines, in the sequence the person building the order chose.
     *
     * `display_order` first with the item name as the tie-break, so an order
     * whose lines were all written with the same ordinal — which is what a
     * client that never reordered produces — still comes back the same way
     * twice. The index behind it is `(purchase_order_id, display_order)`.
     *
     * @return HasMany<PurchaseOrderLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseOrderLine::class)
            ->orderBy('display_order')
            ->orderBy('item_name_en');
    }

    /**
     * Every delivery made against this order, oldest first (§3.5).
     *
     * Oldest first because the detail screen tells the story of an order in the
     * sequence it happened — first the part delivery, then the remainder — which
     * is the opposite of the order book's newest-first list.
     *
     * @return HasMany<GoodsReceipt, $this>
     */
    public function goodsReceipts(): HasMany
    {
        return $this->hasMany(GoodsReceipt::class)
            ->orderBy('received_on')
            ->orderBy('received_at')
            ->orderBy('id');
    }

    /**
     * @return BelongsTo<Supplier, $this>
     */
    public function supplier(): BelongsTo
    {
        return $this->belongsTo(Supplier::class);
    }

    /**
     * @return BelongsTo<OrganisationBranch, $this>
     */
    public function branch(): BelongsTo
    {
        return $this->belongsTo(OrganisationBranch::class, 'branch_id');
    }
}
