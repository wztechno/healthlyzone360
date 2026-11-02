<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\DishMargin;
use Healthy360\Catalogues\Services\DishMargins;
use Healthy360\Kitchens\Services\KitchenServiceSettingsLookup;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/reports/dish-margins — what each dish earns, lowest first.
 *
 * Behind `recipe.view_costs_organisation`, the code the technical sheet's money
 * takes. `is_below_target` reads the target as it stands now, so moving the target
 * moves the flag at once; the figures are as of the last overnight run, and
 * `computed_at` says when.
 */
final class DishMarginIndexController
{
    public function __construct(
        private readonly DishMargins $margins,
        private readonly KitchenServiceSettingsLookup $settings,
        private readonly TenantContext $context,
    ) {}

    public function __invoke(): JsonResponse
    {
        $target = $this->settings->for((string) $this->context->organisationId())->dish_margin_target_percent;
        $rows = $this->margins->list();

        return ApiResponse::data([
            'target_percent' => $target,
            'computed_at' => $rows->max('computed_at')?->toIso8601String(),
            'dishes' => $rows->map(static fn (DishMargin $row): array => [
                'id' => (string) $row->getKey(),
                'catalogue_item_id' => $row->catalogue_item_id,
                'name_en' => (string) $row->catalogueItem?->name_en,
                'name_ar' => $row->catalogueItem?->name_ar,
                'channel' => $row->channel,
                'price_amount' => $row->price_amount === null ? null : (string) $row->price_amount,
                'cost_amount' => $row->cost_amount === null ? null : (string) $row->cost_amount,
                'currency_code' => $row->currency_code,
                'margin_percent' => $row->margin_percent === null ? null : (string) $row->margin_percent,
                'withheld_reason' => $row->withheld_reason,
                'is_below_target' => $target !== null && $row->margin_percent !== null
                    && bccomp((string) $row->margin_percent, (string) $target, 2) < 0,
            ])->values()->all(),
        ]);
    }
}
