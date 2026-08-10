<?php

declare(strict_types=1);

namespace Healthy360\Procurement\Http\Controllers;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\ReferenceData\Models\Currency;
use Healthy360\ReferenceData\Models\MeasurementUnit;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * GET /catalogue/procurement/reference — the small reference sets the
 * goods-receipt form needs to be usable, answered in one read.
 *
 * Three things, each of which the post form was previously guessing at:
 *
 * 1. **The active currencies** a price can be booked in, so the receipt-level
 *    currency picker has something to offer.
 * 2. **The organisation's own default currency** (`organisations.default_currency_code`),
 *    which is the kitchen's currency and the honest default for a receipt — a
 *    selected supplier's currency may pre-select over it, but a receipt no
 *    longer needs a supplier with a currency before a price can be entered.
 * 3. **The measurement units** a purchase line can be quoted in, with each
 *    unit's `dimension`, so the line editor can offer only the units in the
 *    stock item's own dimension (the conversion service refuses across
 *    dimensions, master plan v2 §4.5).
 *
 * Behind `inventory.view_organisation` with the rest of the ops read surface —
 * none of it is a cost figure, so it needs no cost permission. The lists are
 * small and constant, so no cursor is offered.
 */
final class ProcurementReferenceController
{
    public function __invoke(TenantContext $context): JsonResponse
    {
        $currencies = Currency::query()
            ->where('is_active', true)
            ->orderBy('code')
            ->get()
            ->map(fn (Currency $currency): array => [
                'code' => $currency->code,
                'name_en' => $currency->name_en,
            ]);

        $measurementUnits = MeasurementUnit::query()
            ->where('is_active', true)
            ->orderBy('code')
            ->get()
            ->map(fn (MeasurementUnit $unit): array => [
                'id' => (string) $unit->getKey(),
                'code' => $unit->code,
                'dimension' => $unit->dimension,
                'name_en' => $unit->name_en,
            ]);

        $organisationId = $context->organisationId();
        $defaultCurrencyCode = $organisationId === null
            ? null
            : Organisation::query()->whereKey($organisationId)->value('default_currency_code');

        return ApiResponse::data([
            'currencies' => $currencies,
            'default_currency_code' => $defaultCurrencyCode,
            'measurement_units' => $measurementUnits,
        ]);
    }
}
