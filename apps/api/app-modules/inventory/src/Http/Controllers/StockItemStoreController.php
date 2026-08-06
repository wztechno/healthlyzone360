<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Http\Controllers;

use Healthy360\Inventory\Models\StockItem;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

        $item = StockItem::query()->create([
            'organisation_id' => $context->organisationId(),
            'code' => $validated['code'],
            'name_en' => $validated['name_en'],
            'unit_code' => $validated['unit_code'] ?? 'kg',
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
