<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplacePlanVariantsRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanVariantService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/plans/{item}/variants — replace the configuration
 * matrix.
 *
 * A PUT because the matrix is one decision. "These are the configurations we
 * sell" is what a kitchen means, and a PATCH surface would make "I did not
 * touch the premium row" and "I withdrew the premium row" the same request on
 * the thing a subscription's price points at.
 *
 * The response carries **every** cell including the ones this call archived, so
 * a client sees what the submission did rather than what it sent — the same
 * contract `PUT …/items/{item}/variants` offers one level up.
 *
 * `If-Match` carries the item's `lock_version`: the matrix is the unit of
 * change, and the replacement bumps the item so a concurrent editor's next
 * write is refused rather than silently overwriting this one.
 */
final class PlanVariantReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanVariantService $variants,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplacePlanVariantsRequest $request, string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);
        $updated = $this->variants->replace($plan, $request->cells(), $this->requiredLockVersion($request));
        $cells = $this->variants->cellsFor($updated);

        return ApiResponse::data([
            'item' => $this->items->item($updated),
            'cells' => array_map(
                fn (array $cell): array => $this->presenter->cell($cell['profile'], $cell['variant']),
                $cells,
            ),
        ], ['count' => count($cells)])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
