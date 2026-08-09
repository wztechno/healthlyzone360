<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Services;

use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Procurement\Models\GoodsReceipt;
use Healthy360\Procurement\Models\GoodsReceiptLine;
use Illuminate\Support\Facades\DB;

final readonly class GoodsReceiptService
{
    public function __construct(private InventoryService $inventory) {}

    /**
     * @param  list<array{stock_item_id: string, quantity: float}>  $lines
     */
    public function post(
        string $organisationId,
        string $branchId,
        ?string $purchaseOrderId,
        array $lines,
    ): GoodsReceipt {
        return DB::transaction(function () use ($organisationId, $branchId, $purchaseOrderId, $lines): GoodsReceipt {
            $receipt = GoodsReceipt::query()->create([
                'organisation_id' => $organisationId,
                'branch_id' => $branchId,
                'purchase_order_id' => $purchaseOrderId,
                'received_at' => now(),
            ]);

            foreach ($lines as $line) {
                GoodsReceiptLine::query()->create([
                    'goods_receipt_id' => $receipt->getKey(),
                    'stock_item_id' => $line['stock_item_id'],
                    'quantity' => $line['quantity'],
                ]);

                $this->inventory->recordMovement(
                    $organisationId,
                    $branchId,
                    $line['stock_item_id'],
                    'receipt',
                    (string) $line['quantity'],
                    'goods_receipt',
                    (string) $receipt->getKey(),
                );
            }

            return $receipt;
        });
    }
}
