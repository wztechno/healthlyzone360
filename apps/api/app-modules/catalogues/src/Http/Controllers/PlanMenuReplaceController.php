<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Http\Controllers;

use Healthy360\Catalogues\Http\Concerns\ReadsPrecondition;
use Healthy360\Catalogues\Http\Requests\ReplacePlanMenuRequest;
use Healthy360\Catalogues\Presenters\CatalogueItemAdminPresenter;
use Healthy360\Catalogues\Presenters\PlanAdminPresenter;
use Healthy360\Catalogues\Services\PlanLocator;
use Healthy360\Catalogues\Services\PlanMenuService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/catalogue/plans/{item}/menu — replace the plan's fixed menu.
 *
 * A PUT because a menu is one decision. "This is what we serve on a seven-day
 * rotation" is what a kitchen means, and a PATCH surface would make "I did not
 * touch Thursday" and "I cleared Thursday" the same request on the thing a
 * production run is planned from.
 *
 * **The cycle rides in the body rather than on the profile endpoint.**
 * `menu_cycle_days` and `menu_cycle_anchor_date` live on
 * `subscription_plan_profiles`, but `PUT …/profile` is a whole-document write
 * and adding two fields to it would let any client sending a body written
 * before those fields existed silently withdraw a kitchen's menu. They are
 * submitted here, with the dishes they describe, which is also the only place
 * they can be checked against them.
 *
 * They are deliberately **not** served on the profile read either, for the
 * mirror reason: a client that could see them there would sooner or later send
 * them back there, and that write would be ignored. `GET …/menu` is the one
 * place they are read.
 *
 * **Publishing a menu changes what a confirmed subscription order does to the
 * kitchen's stock.** Today a fixed-menu plan generates no meal lines and
 * therefore deducts nothing; once a menu exists, each day's slots become real
 * order lines that explode through their recipes at confirmation, and meals
 * with no published recipe start raising consumption exceptions. The migration
 * that created the table sets that out in full; it is repeated in the OpenAPI
 * description so nobody meets it for the first time in production.
 *
 * `If-Match` carries the item's `lock_version` — a menu, a matrix and a profile
 * are three faces of one listing — and the replacement bumps it so a concurrent
 * editor's next write is refused rather than silently overwriting this one.
 */
final class PlanMenuReplaceController
{
    use ReadsPrecondition;

    public function __construct(
        private readonly PlanLocator $locator,
        private readonly PlanMenuService $menu,
        private readonly PlanAdminPresenter $presenter,
        private readonly CatalogueItemAdminPresenter $items,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplacePlanMenuRequest $request, string $item): JsonResponse
    {
        $plan = $this->locator->plan($item);

        $updated = $this->menu->replace(
            $plan,
            $request->entries(),
            $request->cycleDays(),
            $request->anchorDate(),
            $this->requiredLockVersion($request),
        );

        $entries = $this->menu->entriesFor($updated);
        $meals = $this->menu->mealsFor($entries);

        return ApiResponse::data([
            'item' => $this->items->item($updated),
            'cycle' => $this->menu->cycleFor($updated),
            'entries' => array_map(
                fn ($entry): array => $this->presenter->menuEntry($entry, $meals[$entry->meal_catalogue_item_id] ?? null),
                $entries,
            ),
        ], ['count' => count($entries)])->withHeaders(['ETag' => '"'.$updated->lock_version.'"']);
    }
}
