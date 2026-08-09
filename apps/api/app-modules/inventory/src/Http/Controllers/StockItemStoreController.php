<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

final class StockItemStoreController
{
    public function __invoke(Request $request, TenantContext $context): JsonResponse
    {
        $validated = $request->validate([
            'code' => [
                'required',
                'string',
                'max:64',
                Rule::unique('stock_items', 'code')->where('organisation_id', $context->organisationId()),
            ],
            'name_en' => ['required', 'string', 'max:160'],
            'unit_code' => ['nullable', 'string', 'max:16'],
            'ingredient_id' => ['nullable', 'uuid', Rule::exists('ingredients', 'id')],
        ]);

        $unitCode = $validated['unit_code'] ?? 'kg';

        // Resolve the free-text code to a real measurement unit (INV1.0),
        // falling back to kilograms exactly as the backfill does. A raw lookup
        // rather than a model import: Inventory does not declare a dependency on
        // ReferenceData, and the FK is enough to make the row real.
        $unitId = DB::table('measurement_units')->where('code', $unitCode)->value('id')
            ?? DB::table('measurement_units')->where('code', 'kg')->value('id');

        $item = StockItem::query()->create([
            'organisation_id' => $context->organisationId(),
            'code' => $validated['code'],
            'name_en' => $validated['name_en'],
            'unit_code' => $unitCode,
            'unit_id' => $unitId,
            'ingredient_id' => $validated['ingredient_id'] ?? null,
        ]);

        return ApiResponse::data(['stock_item' => [
            'id' => (string) $item->getKey(),
            'code' => $item->code,
            'name_en' => $item->name_en,
            'unit_code' => $item->unit_code,
            'ingredient_id' => $item->ingredient_id,
        ]], status: 201);
    }
}
