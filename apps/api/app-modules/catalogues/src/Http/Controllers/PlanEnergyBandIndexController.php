<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/plan-vocabulary/energy-bands.
 *
 * Ordered by `display_order` and then by `min_kcal`, so a kitchen that never
 * set an order still gets its bands in the order a human reads them — lowest
 * bracket first — rather than alphabetically, where "1200–1500" and "800–1100"
 * come out backwards.
 *
 * Deactivated rows are served, with their flag: see the combinations index.
 */
final class PlanEnergyBandIndexController
{
    public function __construct(private readonly PlanAdminPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $rows = EnergyBand::query()
            ->orderBy('display_order')
            ->orderBy('min_kcal')
            ->get();

        return ApiResponse::data(
            $rows->map(fn (EnergyBand $row): array => $this->presenter->energyBand($row))->all(),
            ['count' => $rows->count()],
        );
    }
}
