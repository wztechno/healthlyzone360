<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Inventory\Services\InventoryService;
use Healthy360\Production\Models\ProductionOrder;
use Illuminate\Support\Facades\DB;

final readonly class ProductionService
{
    public function __construct(private InventoryService $inventory) {}

    /**
     * @param  list<array{stock_item_id: string, quantity: float}>  $consumes
     * @param  list<array{stock_item_id: string, quantity: float}>  $yields
     */
    public function complete(
        ProductionOrder $order,
        array $consumes,
        array $yields,
    ): ProductionOrder {
        return DB::transaction(function () use ($order, $consumes, $yields): ProductionOrder {
            foreach ($consumes as $line) {
                $this->inventory->recordMovement(
                    $order->organisation_id,
                    $order->branch_id,
                    $line['stock_item_id'],
                    'consume',
                    -abs($line['quantity']),
                    'production_order',
                    (string) $order->getKey(),
                );
            }

            foreach ($yields as $line) {
                $this->inventory->recordMovement(
                    $order->organisation_id,
                    $order->branch_id,
                    $line['stock_item_id'],
                    'yield',
                    $line['quantity'],
                    'production_order',
                    (string) $order->getKey(),
                );
            }

            $order->status = 'completed';
            $order->save();

            return $order;
        });
    }
}
