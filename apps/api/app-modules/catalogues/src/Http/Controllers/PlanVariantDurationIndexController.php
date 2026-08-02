<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanDurationAssignmentService;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/catalogue/plans/{item}/variant-durations.
 *
 * The runs each configuration may be bought for, across the whole plan.
 *
 * `discount_percent` is served as `null` where nobody has stated one — never as
 * `"0.00"`, and never omitted. The absence has to be visible, because the
 * person reading this screen is the person who has to go and find the number.
 */
final class PlanVariantDurationIndexController
{
    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanDurationAssignmentService $assignments,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);
        $rows = $this->assignments->assignmentsFor($plan);

        return ApiResponse::data([
            'item' => $this->items->item($plan),
            'assignments' => array_map(
                fn (array $row): array => $this->presenter->durationAssignment($row['assignment'], $row['variant']),
                $rows,
            ),
        ], [
            'count' => count($rows),

            // How many rows still have no stated discount. Surfaced in `meta`
            // rather than left to a client to count, because "how much of this
            // plan is still unpriced commercially" is the question the screen
            // exists to answer.
            'unstated_discount_count' => count(array_filter(
                $rows,
                static fn (array $row): bool => $row['assignment']->discount_percent === null,
            )),
        ])->withHeaders(['ETag' => '"'.$plan->lock_version.'"']);
    }
}
