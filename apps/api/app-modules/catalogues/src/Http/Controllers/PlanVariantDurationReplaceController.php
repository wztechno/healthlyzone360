<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplacePlanVariantDurationsRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanDurationAssignmentService;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/plans/{item}/variant-durations.
 *
 * The complete set of configuration × duration pairings, applied at once. A
 * kitchen decides "every cell runs 5, 20 and 40 days, and the premium tier also
 * runs 60" in one sitting, and splitting that across calls would make the
 * half-applied states reachable and publishable.
 *
 * Rows name their configuration and duration by identifier **or by code**, so
 * an importer holding codes does not have to round-trip through this API to
 * learn identifiers it will never use again.
 *
 * An absent `discount_percent` stays absent all the way to the column: NULL is
 * "nobody has stated one", `0` is "there is no discount", and this endpoint
 * never turns the first into the second.
 *
 * `If-Match` carries the item's validator.
 */
final class PlanVariantDurationReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanDurationAssignmentService $assignments,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplacePlanVariantDurationsRequest $request, string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);
        $updated = $this->assignments->replace($plan, $request->assignments(), $this->requiredLockVersion($request));
        $rows = $this->assignments->assignmentsFor($updated);

        return ApiResponse::data([
            'item' => $this->items->item($updated),
            'assignments' => array_map(
                fn (array $row): array => $this->presenter->durationAssignment($row['assignment'], $row['variant']),
                $rows,
            ),
        ], [
            'count' => count($rows),
            'unstated_discount_count' => count(array_filter(
                $rows,
                static fn (array $row): bool => $row['assignment']->discount_percent === null,
            )),
        ])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
