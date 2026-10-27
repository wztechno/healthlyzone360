<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Inventory\Models\IngredientStockCost;
use Healthy360\Inventory\Models\StockItem;
use Healthy360\Inventory\Models\StockLevel;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Support\Spreadsheet\ImportResult;
use Healthy360\Support\Spreadsheet\SpreadsheetReader;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * The stock count sheet: one branch's shelves out as a workbook, and a counted
 * workbook back in as stock counts and reorder points.
 *
 * The import never creates a stock item — shelves are derived from ingredients
 * and products (INV2.0) — so an unknown code is skipped, not minted. A counted
 * figure goes through {@see InventoryService::recordCount()} and a threshold
 * through {@see InventoryService::setThreshold()}, so the sheet obeys exactly
 * the rules the single-item endpoints do. A blank cell means "leave it alone":
 * the sheet cannot clear a threshold, the screen can.
 *
 * The export leaves `Counted quantity` blank and prints the ledger figure in
 * the read-only `On hand` column. A sheet exported on Monday and re-uploaded on
 * Friday would otherwise reset every shelf to Monday's figure.
 */
final readonly class StockCountSpreadsheetService
{
    /** @var list<string> the columns the import reads, in template order */
    public const array HEADERS = ['Code', 'Item', 'Counted quantity', 'Reorder threshold', 'Par level'];

    /** @var list<string> the read-only columns the export appends, always */
    public const array EXPORT_HEADERS = ['Unit', 'On hand', 'Low'];

    /** @var list<string> appended after {@see EXPORT_HEADERS} only for a caller who may see costs */
    public const array COST_HEADERS = ['Unit cost', 'Currency'];

    /** @var list<string|int|float|null> */
    public const array EXAMPLE = ['EXAMPLE', 'Basmati rice', 12.5, 5, 20];

    /**
     * key => header. The read-only export columns are listed so that a
     * re-uploaded export does not report them as unknown; their values are
     * never read.
     *
     * @var array<string, string>
     */
    private const array COLUMNS = [
        'code' => 'Code',
        'item' => 'Item',
        'counted_quantity' => 'Counted quantity',
        'reorder_threshold' => 'Reorder threshold',
        'par_level' => 'Par level',
        'unit' => 'Unit',
        'on_hand' => 'On hand',
        'low' => 'Low',
        'unit_cost' => 'Unit cost',
        'currency' => 'Currency',
    ];

    private const int MAX_ROWS = 2000;

    public function __construct(
        private SpreadsheetReader $reader,
        private InventoryService $inventory,
        private AuditRecorder $audit,
        private TenantContext $context,
    ) {}

    /**
     * @throws ValidationException when the file itself is unreadable or has no `Code` header
     */
    public function import(string $path, string $branchId): ImportResult
    {
        $sheet = $this->reader->read($path, self::COLUMNS, ['code'], self::MAX_ROWS);

        $result = new ImportResult;
        $result->ignoredColumns($sheet['ignored_columns']);

        foreach ($sheet['rows'] as $row) {
            $code = $row['values']['code'] ?? null;

            try {
                DB::transaction(fn () => $this->importRow($row, $branchId, $result));
            } catch (ApiException $e) {
                $result->failed($row['row'], $code, $e->getMessage());
            } catch (ValidationException $e) {
                $result->failed($row['row'], $code, implode(' ', array_merge(...array_values($e->errors()))));
            } catch (Throwable $e) {
                report($e);
                $result->failed($row['row'], $code, 'The row could not be imported.');
            }
        }

        $this->audit->record(
            'inventory.count_sheet_imported',
            actorUserId: $this->context->userId(),
            subjectType: 'branch',
            subjectId: $branchId,
            metadata: [
                'created' => $result->count('created'),
                'updated' => $result->count('updated'),
                'unchanged' => $result->count('unchanged'),
                'skipped' => $result->count('skipped'),
                'failed' => $result->count('failed'),
            ],
        );

        return $result;
    }

    /**
     * @return list<string>
     */
    public function exportHeaders(bool $withCosts): array
    {
        return [...self::HEADERS, ...self::EXPORT_HEADERS, ...($withCosts ? self::COST_HEADERS : [])];
    }

    /**
     * Every stock item of the organisation, by code, with this branch's level.
     *
     * @return iterable<list<string|int|float|null>>
     */
    public function exportRows(string $branchId, bool $withCosts): iterable
    {
        $levels = StockLevel::query()->where('branch_id', $branchId)->get()->keyBy('stock_item_id');
        $costs = $withCosts ? IngredientStockCost::query()->get()->keyBy('ingredient_id') : collect();

        foreach (StockItem::query()->orderBy('code')->get() as $item) {
            /** @var StockLevel|null $level */
            $level = $levels->get($item->id);
            $threshold = $level?->reorder_threshold === null ? null : (string) $level->reorder_threshold;
            $quantity = $level === null ? '0' : (string) $level->quantity;

            $row = [
                $item->code,
                $item->name_en,
                null,
                self::number($threshold),
                self::number($level?->par_level === null ? null : (string) $level->par_level),
                $item->unit_code,
                self::number($quantity),
                InventoryService::isLowStock($threshold, $quantity) ? 'Yes' : 'No',
            ];

            if ($withCosts) {
                /** @var IngredientStockCost|null $cost */
                $cost = $item->ingredient_id === null ? null : $costs->get($item->ingredient_id);
                $row[] = self::number($cost?->moving_average_cost_amount === null ? null : (string) $cost->moving_average_cost_amount);
                $row[] = $cost?->currency_code;
            }

            yield $row;
        }
    }

    /**
     * @return list<list<string|int|float|null>>
     */
    public function templateRows(): array
    {
        return [self::EXAMPLE];
    }

    /**
     * @param  array{row: int, values: array<string, string|null>, example: bool}  $row
     *
     * @throws ValidationException
     */
    private function importRow(array $row, string $branchId, ImportResult $result): void
    {
        if ($row['example']) {
            $result->skipped($row['row'], null, 'Example row.');

            return;
        }

        $values = $row['values'];
        $item = StockItem::query()->where('code', $values['code'] ?? null)->first();

        if ($item === null) {
            $result->skipped($row['row'], $values['code'] ?? null, 'Unknown stock code — stock items are never created by import.');

            return;
        }

        Validator::make($values, [
            'counted_quantity' => ['nullable', 'numeric', 'min:0'],
            'reorder_threshold' => ['nullable', 'numeric', 'min:0'],
            'par_level' => ['nullable', 'numeric', 'min:0'],
        ], [], self::COLUMNS)->validate();

        $counted = self::numericOrNull($values['counted_quantity'] ?? null);
        $threshold = self::numericOrNull($values['reorder_threshold'] ?? null);
        $par = self::numericOrNull($values['par_level'] ?? null);
        $changed = false;

        if ($counted !== null) {
            // Always posts, a zero delta included: "counted, and it agreed" is
            // a stock-take worth keeping (the service's own rule).
            $this->inventory->recordCount($item->organisation_id, $branchId, $item->id, $counted, 'Count sheet import');
            $changed = true;
        }

        $level = StockLevel::query()->where('branch_id', $branchId)->where('stock_item_id', $item->id)->first();
        $storedThreshold = $level?->reorder_threshold === null ? null : (string) $level->reorder_threshold;
        $storedPar = $level?->par_level === null ? null : (string) $level->par_level;

        if (self::differs($threshold, $storedThreshold) || self::differs($par, $storedPar)) {
            // The endpoint needs the threshold stated; a row that only moves
            // par keeps the stored one rather than clearing it.
            $this->inventory->setThreshold(
                $item->organisation_id,
                $branchId,
                $item->id,
                $threshold ?? $storedThreshold,
                $par !== null,
                $par,
                $this->context->userId(),
            );
            $changed = true;
        }

        if ($changed) {
            $result->updated($row['row'], $item->code);
        } else {
            $result->unchanged();
        }
    }

    /**
     * Whether a stated cell moves the stored figure. A blank cell never does.
     *
     * @param  numeric-string|null  $given
     * @param  numeric-string|null  $stored
     */
    private static function differs(?string $given, ?string $stored): bool
    {
        return $given !== null && ($stored === null || bccomp($given, $stored, 4) !== 0);
    }

    /**
     * @return numeric-string|null
     */
    private static function numericOrNull(?string $value): ?string
    {
        return is_numeric($value) ? $value : null;
    }

    /**
     * A decimal as a number cell, so the sheet can sum it.
     */
    private static function number(?string $value): ?float
    {
        return $value === null ? null : (float) $value;
    }
}
