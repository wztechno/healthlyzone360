<?php

declare(strict_types=1);

namespace Healthy360\Production\Services;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Services\RequirementForecast;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/**
 * Shelf names and unit codes for a batch's lines, resolved once per request (PROD1).
 *
 * A production line is a claim on a **shelf**, so the label it wants is the stock
 * item's — the words on the shelf the cook walks to — and not the ingredient's.
 * {@see RequirementForecast} settled that for the
 * buy list and emits `code`, `name_en` and `unit_code` beside every row; this is
 * the same three for the same reason, on the surface next door.
 *
 * ## Why a memo rather than an eager load
 *
 * A batch's lines are `production_order_lines` rows on one read and
 * {@see BatchPlanLine} value objects on another — the plan is computed, never
 * persisted, so there is nothing to `with()`. One resolver serves both, and the
 * memo is what keeps a show response that renders lines *and* a plan at two
 * queries rather than four.
 *
 * A name that does not resolve stays null and reads as an em dash. That is a
 * shelf outside this tenant or one that has been deleted, and both are "nobody
 * can tell you" — never a blank that looks like an unnamed shelf.
 */
final class StockItemLabels
{
    /** @var array<string, array{code: string, name_en: string}> */
    private array $stockItems = [];

    /** @var array<string, string> */
    private array $unitCodes = [];

    /** @var array<string, true> ids already asked about, resolved or not */
    private array $askedStockItems = [];

    /** @var array<string, true> */
    private array $askedUnits = [];

    /**
     * Load anything not already known. Tenant-scoped by the model's own global
     * scope, so an id from another organisation simply does not come back.
     *
     * @param  list<string>  $stockItemIds
     * @param  list<string>  $unitIds
     */
    public function prime(array $stockItemIds, array $unitIds): void
    {
        $missingItems = array_values(array_filter(
            array_unique($stockItemIds),
            fn (string $id): bool => ! isset($this->askedStockItems[$id]),
        ));

        if ($missingItems !== []) {
            foreach ($missingItems as $id) {
                $this->askedStockItems[$id] = true;
            }

            foreach (StockItem::query()->whereIn('id', $missingItems)->get(['id', 'code', 'name_en']) as $item) {
                $this->stockItems[(string) $item->getKey()] = [
                    'code' => $item->code,
                    'name_en' => $item->name_en,
                ];
            }
        }

        $missingUnits = array_values(array_filter(
            array_unique($unitIds),
            fn (string $id): bool => ! isset($this->askedUnits[$id]),
        ));

        if ($missingUnits === []) {
            return;
        }

        foreach ($missingUnits as $id) {
            $this->askedUnits[$id] = true;
        }

        foreach (MeasurementUnit::query()->whereIn('id', $missingUnits)->get(['id', 'code']) as $unit) {
            $this->unitCodes[(string) $unit->getKey()] = $unit->code;
        }
    }

    public function code(string $stockItemId): ?string
    {
        return $this->stockItems[$stockItemId]['code'] ?? null;
    }

    public function name(string $stockItemId): ?string
    {
        return $this->stockItems[$stockItemId]['name_en'] ?? null;
    }

    public function unitCode(string $unitId): ?string
    {
        return $this->unitCodes[$unitId] ?? null;
    }
}
