<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;

/**
 * Route parameters for the plan family, turned into records the caller may see
 * — or into a 404.
 *
 * A sibling of `CatalogueLocator` rather than a set of methods on it, for the
 * reason that class gives for existing at all: route-model binding runs before
 * `org.context`, so a scoped model resolved there would either fail closed
 * before the context exists or bypass the scope entirely. Splitting the plan
 * vocabulary out keeps the K1.4 locator readable.
 *
 * Every vocabulary row is addressable by identifier **or by its own code**, the
 * same courtesy items and channels get: a client that walked the list holds
 * one, and a human or an importer holds the other.
 *
 * `plan()` is deliberately not `item()` with a check bolted on. Reaching a
 * product through a plan route is not a permission failure and not a validation
 * failure — the resource named by `/catalogue/plans/{item}` genuinely does not
 * exist — but the refusal is a **422**, not a 404, because the caller can see
 * the row perfectly well through `/catalogue/items/{item}` and a 404 would send
 * them looking for a typo. The distinction matters enough to be a method.
 */
final class PlanLocator
{
    public function __construct(private readonly CatalogueLocator $catalogue) {}

    /**
     * A catalogue item that really is a subscription plan.
     *
     * @throws ApiException
     */
    public function plan(string $id): CatalogueItem
    {
        $item = $this->catalogue->item($id);

        if ($item->item_type !== CatalogueItemType::SubscriptionPlan) {
            throw new ApiException(
                ErrorCode::ValidationFailed,
                'This catalogue item is a '.$item->item_type->value.', not a subscription plan. Only a plan has a profile, a matrix and durations.',
                ['fields' => ['item' => ['This catalogue item is not a subscription plan.']], 'item_type' => $item->item_type->value],
            );
        }

        return $item;
    }

    /**
     * @throws ApiException
     */
    public function combination(string $id): MealCombinationOption
    {
        $query = MealCombinationOption::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('code', $id);

        $row = $query->first();

        if (! $row instanceof MealCombinationOption) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $row;
    }

    /**
     * @throws ApiException
     */
    public function energyBand(string $id): EnergyBand
    {
        $query = EnergyBand::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('code', $id);

        $row = $query->first();

        if (! $row instanceof EnergyBand) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $row;
    }

    /**
     * @throws ApiException
     */
    public function duration(string $id): PlanDuration
    {
        $query = PlanDuration::query();

        $this->looksLikeUuid($id)
            ? $query->whereKey($id)
            : $query->where('code', $id);

        $row = $query->first();

        if (! $row instanceof PlanDuration) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $row;
    }

    /**
     * Recognised by shape rather than by trying the key first, for
     * `CatalogueLocator`'s reason: a malformed identifier would otherwise reach
     * PostgreSQL as `uuid = 'not-a-uuid'`, which is an error rather than an
     * empty set.
     */
    private function looksLikeUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
