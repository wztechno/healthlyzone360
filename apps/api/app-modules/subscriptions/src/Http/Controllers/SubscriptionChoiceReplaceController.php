<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Subscriptions\Http\Concerns\ReadsOptionalPrecondition;
use Healthy360\Subscriptions\Http\Requests\ReplaceSubscriptionChoicesRequest;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\MealChoiceService;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;

/**
 * PUT /api/v1/me/subscriptions/{subscription}/choices — Free Selection,
 * choose-ahead (§7).
 *
 * **One day per call, named in the body rather than in the path.** A date is
 * not an identifier of anything — the delivery row usually does not exist yet,
 * which is the whole point — so `…/choices/{date}` would be a path segment that
 * looks like a resource and is not one. It also keeps the door open for a
 * future call that sets a week in one transaction without changing the URL's
 * meaning.
 *
 * **`{"meals": []}` is a real payload.** It is a customer saying "I have not
 * chosen; send me the kitchen's default", and the request declares `meals`
 * `present` rather than `required` so that it is expressible. A merge-shaped
 * `PATCH` could not say it at all.
 *
 * **No allergen verdict in the response, and that is deliberate.** Generation
 * runs `MealSafety::check()` over every choice at the moment it builds the day,
 * against the customer's declarations *as they stand then*. Answering "this is
 * safe" here would be a verdict that goes stale the moment somebody adds an
 * allergy — and a client that had once been told "safe" would have no reason to
 * ask again. What comes back is what was recorded, with `source: customer` on
 * every row; what arrives is decided later and is reported on the delivery.
 */
final class SubscriptionChoiceReplaceController
{
    use ReadsOptionalPrecondition;

    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly MealChoiceService $choices,
        private readonly SubscriptionPresenter $presenter,
        private readonly SubscriptionProjection $projection,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(ReplaceSubscriptionChoicesRequest $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        /** @var string $date */
        $date = $request->validated('date');
        $day = CarbonImmutable::createFromFormat('Y-m-d', $date)->startOfDay();

        $written = $this->choices->replace(
            $record,
            $day,
            $request->meals(),
            $this->optionalLockVersion($request),
        );

        // The dish names come back with the choices, resolved from the catalogue
        // rather than echoed from the request — the request has no field for a
        // name and must not grow one. A caller-supplied label on a surface this
        // close to safety could disagree with the item actually recorded, and
        // the screen showing it would be describing food nobody will cook.
        $mealNames = $this->projection->mealNames(
            $written,
            $record->organisation_id,
            SubscriptionLocale::from($request->header('Accept-Language')),
        );

        return ApiResponse::data([
            'delivery_date' => $day->toDateString(),
            'meals' => $written->map(
                fn (SubscriptionMealChoice $choice): array => $this->presenter->mealChoice($choice, $mealNames),
            )->all(),
        ]);
    }
}
