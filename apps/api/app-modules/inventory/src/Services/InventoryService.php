<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Inventory\Models\StockMovement;
use Illuminate\Support\Facades\DB;

final readonly class InventoryService
{
    public function recordMovement(
        string $organisationId,
        string $branchId,
        string $stockItemId,
        string $reason,
        float $quantityDelta,
        ?string $referenceType = null,
        ?string $referenceId = null,
        ?string $notes = null,
    ): StockMovement {
        return DB::transaction(function () use ($organisationId, $branchId, $stockItemId, $reason, $quantityDelta, $referenceType, $referenceId, $notes): StockMovement {
            $level = StockLevel::query()->firstOrCreate(
                ['branch_id' => $branchId, 'stock_item_id' => $stockItemId],
                ['quantity' => 0],
            );

            $level->quantity = (float) $level->quantity + $quantityDelta;
            $level->save();

            return StockMovement::query()->create([
                'organisation_id' => $organisationId,
                'branch_id' => $branchId,
                'stock_item_id' => $stockItemId,
                'quantity_delta' => $quantityDelta,
                'reason' => $reason,
                'reference_type' => $referenceType,
                'reference_id' => $referenceId,
                'notes' => $notes,
            ]);
        });
    }
}
