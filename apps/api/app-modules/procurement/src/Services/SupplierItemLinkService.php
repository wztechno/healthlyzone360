<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Procurement\Models\Supplier;
use Healthy360\Procurement\Models\SupplierStockItem;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The one mutation surface for supplier↔item links (§3.3, §6).
 *
 * **One idempotent upsert and one idempotent delete, not two mirrored
 * replaces.** A supplier's supplied items and an item's suppliers are the same
 * set read from two ends, and giving each end its own set-replace endpoint
 * would let two screens overwrite each other's view of one table: linking an
 * item on the supplier page would silently unlink every supplier the item page
 * had just added. The link is a fact about a *pair*, so the pair is what a
 * request names, and sending the same request twice leaves the same row.
 *
 * ## Preferred is cleared before it is set
 *
 * The partial unique index (`is_preferred`) is checked **per statement**, not
 * at commit. Promoting supplier B while supplier A still holds the flag would
 * raise a 23505 halfway through a transaction whose end state is perfectly
 * legal — and a constraint violation surfacing as a 500 tells the person
 * nothing. Clearing every other holder for that stock item first, inside the
 * same transaction, is what makes a straight handover possible. The same
 * ordering `SupplierContactService::replace` uses for the primary contact, for
 * the same reason.
 *
 * ## Cross-organisation ids are not found, in both directions
 *
 * Both ends are validated against the active organisation before anything is
 * written. A supplier belonging to another kitchen and a stock item belonging
 * to another kitchen are both `ResourceNotFound` — never a 403 and never a
 * silent link — because "does this id exist" is itself the answer a tenant is
 * not entitled to.
 *
 * Audit metadata is identifiers and the preferred flag only: never an amount,
 * and never a key containing `code`, which `AuditRecorder` redacts blindly by
 * substring. `supplier_item_ref` is not recorded at all — it is the supplier's
 * commercial reference, and the audit event is about the link rather than about
 * what the supplier calls the thing.
 */
final readonly class SupplierItemLinkService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * Create or update one link. Idempotent on the (supplier, item) pair.
     *
     * `$isPreferred` and `$supplierItemRef` are keyed on presence rather than
     * on null, exactly as the supplier PATCH is: `null` clears a reference the
     * kitchen typed by mistake, while omitting it leaves the stored one alone.
     * A `false` preferred flag clears this link's own flag and nothing else —
     * demoting a supplier does not promote another one, because the system has
     * no opinion about who should take over.
     *
     * @throws ApiException
     */
    public function upsert(
        string $supplierId,
        string $stockItemId,
        ?bool $isPreferred = null,
        ?string $supplierItemRef = null,
        bool $referenceGiven = false,
    ): SupplierStockItem {
        $supplier = $this->supplier($supplierId);
        $stockItem = $this->stockItem($stockItemId);

        $link = DB::transaction(function () use ($supplier, $stockItem, $isPreferred, $supplierItemRef, $referenceGiven): SupplierStockItem {
            if ($isPreferred === true) {
                // Before, not after: the partial unique index is checked per
                // statement, so two rows claiming the flag at any point inside
                // the transaction is a 23505 even when the end state is legal.
                SupplierStockItem::query()
                    ->where('stock_item_id', $stockItem->getKey())
                    ->where('supplier_id', '!=', $supplier->getKey())
                    ->where('is_preferred', true)
                    ->update(['is_preferred' => false]);
            }

            $link = SupplierStockItem::query()
                ->where('supplier_id', $supplier->getKey())
                ->where('stock_item_id', $stockItem->getKey())
                ->first();

            $attributes = [];

            if ($isPreferred !== null) {
                $attributes['is_preferred'] = $isPreferred;
            }

            if ($referenceGiven) {
                $trimmed = $supplierItemRef === null ? null : trim($supplierItemRef);
                $attributes['supplier_item_ref'] = $trimmed === '' ? null : $trimmed;
            }

            if ($link instanceof SupplierStockItem) {
                if ($attributes !== []) {
                    $link->fill($attributes)->save();
                }

                return $link;
            }

            return SupplierStockItem::query()->create($attributes + [
                'organisation_id' => $supplier->organisation_id,
                'supplier_id' => $supplier->getKey(),
                'stock_item_id' => $stockItem->getKey(),
                'is_preferred' => $isPreferred ?? false,
            ]);
        });

        $this->audit->record(
            'procurement.supplier_item_linked',
            actorUserId: $this->context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            metadata: [
                'stock_item_id' => (string) $stockItem->getKey(),
                'is_preferred' => $link->is_preferred,
            ],
        );

        return $link;
    }

    /**
     * Remove one link. Idempotent: deleting a link that is not there is not an
     * error, because the caller's intention — "they do not sell us this" — is
     * already true.
     *
     * A delete is allowed here where a supplier's own record only archives,
     * and the difference is what the row *is*: a link is current configuration,
     * and a receipt posted against the supplier remains history whether the
     * link stands or not.
     *
     * @throws ApiException
     */
    public function delete(string $supplierId, string $stockItemId): void
    {
        $supplier = $this->supplier($supplierId);
        $stockItem = $this->stockItem($stockItemId);

        $deleted = SupplierStockItem::query()
            ->where('supplier_id', $supplier->getKey())
            ->where('stock_item_id', $stockItem->getKey())
            ->delete();

        if ($deleted === 0) {
            return;
        }

        $this->audit->record(
            'procurement.supplier_item_unlinked',
            actorUserId: $this->context->userId(),
            subjectType: 'supplier',
            subjectId: (string) $supplier->getKey(),
            metadata: ['stock_item_id' => (string) $stockItem->getKey()],
        );
    }

    /**
     * @throws ApiException
     */
    private function supplier(string $supplierId): Supplier
    {
        $supplier = Supplier::query()->whereKey($supplierId)->first();

        if ($supplier === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $supplier;
    }

    /**
     * The shelf, read through Inventory's own organisation scope.
     *
     * Procurement reads Inventory models directly — the declared module
     * direction allows it, and the reverse is what `ModuleRegistryTest` refuses
     * — so the global scope on {@see StockItem} is the tenancy check rather
     * than a hand-written `where`.
     *
     * @throws ApiException
     */
    private function stockItem(string $stockItemId): StockItem
    {
        $stockItem = StockItem::query()->whereKey($stockItemId)->first();

        if ($stockItem === null) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $stockItem;
    }
}
