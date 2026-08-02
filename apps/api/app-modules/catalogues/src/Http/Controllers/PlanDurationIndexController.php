<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Support\Api\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/plan-vocabulary/durations.
 *
 * Ordered by `display_order`, then by `duration_days` with **nulls first**: a
 * one-off is the shortest commitment there is, so it belongs at the top of a
 * list a customer reads downwards into longer runs. Sorting on the number alone
 * would put it wherever PostgreSQL happens to place NULLs, which is last by
 * default — the one-off at the bottom, past sixty days.
 */
final class PlanDurationIndexController
{
    public function __construct(private readonly PlanAdminPresenter $presenter) {}

    public function __invoke(): JsonResponse
    {
        $rows = PlanDuration::query()
            ->orderBy('display_order')
            ->orderByRaw('duration_days nulls first')
            ->orderBy('code')
            ->get();

        return ApiResponse::data(
            $rows->map(fn (PlanDuration $row): array => $this->presenter->duration($row))->all(),
            ['count' => $rows->count()],
        );
    }
}
