<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Carbon\CarbonImmutable;
use Healthy360\Orders\Services\SellerContext;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\ChangeWindow;
use Healthy360\Subscriptions\Services\MealChoiceService;
use Healthy360\Subscriptions\Services\ScheduleProjection;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/subscriptions/{subscription}/days — the customer's meals,
 * day by day, from today to the end of the balance.
 *
 * **The customer's own plan, so the projection is served here.** The ledger
 * (`…/deliveries`) lists only rows that exist; this lists the days the
 * customer chose meals for, which are mostly days no row asserts yet. Each day
 * says which it is (`basis: actual | projected`), so a screen never presents a
 * forecast as a commitment.
 *
 * `editable` is the change window's answer for that date — the same
 * `ChangeWindow` the `PUT …/choices` gate asks — and false for a day that is
 * already settled. `sittings` is the shape every day must fill, so a client
 * draws one picker per sitting without re-deriving the rule.
 */
final class MySubscriptionDayIndexController
{
    /** Far enough for the longest plan; the balance stops the walk long before. */
    private const int HORIZON_DAYS = 400;

    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly ScheduleProjection $schedule,
        private readonly MealChoiceService $choices,
        private readonly ChangeWindow $window,
        private readonly SubscriptionPresenter $presenter,
        private readonly SubscriptionProjection $projection,
        private readonly SellerContext $seller,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        $now = CarbonImmutable::now();
        $from = $now->startOfDay();

        $days = $this->seller->during(
            $record->organisation_id,
            $record->branch_id,
            fn (): array => $this->schedule->forSubscription($record, $from, $from->addDays(self::HORIZON_DAYS)),
        );

        $dates = array_column($days, 'delivery_date');

        $choices = $dates === []
            ? SubscriptionMealChoice::query()->whereRaw('false')->get()
            : SubscriptionMealChoice::query()
                ->where('subscription_id', $record->getKey())
                ->whereIn('delivery_date', $dates)
                ->orderBy('delivery_date')
                ->orderBy('slot')
                ->orderBy('sequence')
                ->get();

        $byDate = $choices->groupBy(static fn (SubscriptionMealChoice $choice): string => $choice->delivery_date->toDateString());

        $mealNames = $this->projection->mealNames(
            $choices,
            $record->organisation_id,
            SubscriptionLocale::from($request->header('Accept-Language')),
        );

        $live = $record->status->isLive();

        return ApiResponse::data([
            'sittings' => $this->choices->sittingsOf($record),
            'days' => array_map(function (array $day) use ($record, $byDate, $mealNames, $now, $live): array {
                $date = CarbonImmutable::parse($day['delivery_date']);

                return [
                    'delivery_date' => $day['delivery_date'],
                    'basis' => $day['basis'],
                    'status' => $day['status'],
                    'editable' => $live
                        && $day['basis'] === 'projected'
                        && $this->window->reasonsFor($record, $date, $now) === [],
                    'change_deadline' => $this->window->deadlineFor($record, $date)->toIso8601String(),
                    'meals' => $byDate->get($day['delivery_date'], collect())
                        ->map(fn (SubscriptionMealChoice $choice): array => $this->presenter->mealChoice($choice, $mealNames))
                        ->values()
                        ->all(),
                ];
            }, $days),
        ]);
    }
}
