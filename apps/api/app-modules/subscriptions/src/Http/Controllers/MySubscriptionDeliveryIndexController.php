<?php

declare(strict_types=1);

namespace Healthy360\Subscriptions\Http\Controllers;

use Healthy360\Subscriptions\Models\SubscriptionDelivery;
use Healthy360\Subscriptions\Models\SubscriptionMealChoice;
use Healthy360\Subscriptions\Presenters\SubscriptionLocale;
use Healthy360\Subscriptions\Presenters\SubscriptionPresenter;
use Healthy360\Subscriptions\Services\SubscriptionLocator;
use Healthy360\Subscriptions\Services\SubscriptionProjection;
use Healthy360\Subscriptions\Services\SubscriptionService;
use Healthy360\Support\Api\ApiResponse;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/me/subscriptions/{subscription}/deliveries — the ledger.
 *
 * **The rows that exist, and only those.** This is deliberately *not* the
 * customer's version of `ScheduleProjection`: it lists real
 * `subscription_deliveries` — days generated, days skipped, days delivered —
 * newest first. A customer asking "what happened to my Tuesday" is asking about
 * a day that exists; what is *coming* is `next_delivery_date` on the
 * subscription plus the weekday pattern, which the client already holds and can
 * render without the platform inventing rows.
 *
 * That asymmetry with the kitchen surface is intentional. A kitchen plans
 * production and needs the projection with `basis: projected` labelled as such;
 * a customer needs a history. Serving projections here would put days into
 * somebody's ledger that nothing has committed to, and the first support
 * question would be why a delivery "disappeared" when the plan was paused.
 *
 * **The meal choices ride along**, in one query for the whole page rather than
 * one per day — the N+1 `MyOrderIndexController` takes the same care over. They
 * carry `source` and `replaced_catalogue_item_id`, which is how a customer sees
 * that something they chose was swapped and what went instead: the §6
 * substitution promise is worth nothing if the only place it is recorded is an
 * audit table.
 *
 * `unsafe_allergen_classes` is **not** served. It is `SpecialCategory` — a list
 * of allergen classes attached to a named person's delivery is health data —
 * and the customer already knows their own declarations; what they need from
 * this screen is that a substitution happened, not a restatement of their
 * medical profile on a delivery row.
 */
final class MySubscriptionDeliveryIndexController
{
    public function __construct(
        private readonly SubscriptionLocator $locator,
        private readonly SubscriptionService $subscriptions,
        private readonly SubscriptionPresenter $presenter,
        private readonly SubscriptionProjection $projection,
    ) {}

    /**
     * @throws ApiException
     */
    public function __invoke(Request $request, string $subscription): JsonResponse
    {
        $account = $this->locator->shopper($request);
        $record = $this->locator->subscription($account, $subscription);

        $deliveries = SubscriptionDelivery::query()
            ->where('subscription_id', $record->getKey())
            ->orderByDesc('delivery_date')
            ->orderByDesc('id')
            ->get();

        $rows = $this->choiceRows($record->getKey(), $deliveries->isNotEmpty());
        $choices = $this->groupByDate($rows);

        // One catalogue read for the whole page. A dish's name is the only part
        // of a choice a person can actually read, and resolving it server-side
        // is what stops a client holding its own copy of the menu.
        $mealNames = $this->projection->mealNames(
            $rows,
            $record->organisation_id,
            SubscriptionLocale::from($request->header('Accept-Language')),
        );

        return ApiResponse::data(
            $deliveries->map(fn (SubscriptionDelivery $delivery): array => $this->presenter->delivery(
                $delivery,
                $choices[$delivery->delivery_date->toDateString()] ?? [],
                $mealNames,
            ))->all(),
            [
                'count' => $deliveries->count(),
                // The balance travels in `meta` rather than in `data`, because
                // `data` is the collection. A client rendering a ledger nearly
                // always renders "8 of 20 days used" above it, and a second
                // call for two integers is a round trip for nothing.
                'balance' => $this->subscriptions->balance($record),
            ],
        );
    }

    /**
     * Every choice for a whole page, in one statement, grouped by delivery day.
     *
     * Keyed on the **date** rather than on `subscription_delivery_id`, because a
     * choice may be made before the day exists — that is the whole meaning of
     * choosing ahead — and generation links the two only when it creates the
     * row. Grouping on the foreign key would silently drop every choice made in
     * advance, which is most of them.
     *
     * `$hasDeliveries` short-circuits the query when the ledger is empty. It is
     * not a filter: choices genuinely can exist for days that have no delivery
     * row yet, and they are correctly invisible here, because this endpoint
     * lists the days that *happened* rather than the days somebody has planned.
     *
     * @return Collection<int, SubscriptionMealChoice>
     */
    private function choiceRows(mixed $subscriptionId, bool $hasDeliveries): Collection
    {
        if (! $hasDeliveries) {
            /** @var Collection<int, SubscriptionMealChoice> $empty */
            $empty = new Collection;

            return $empty;
        }

        return SubscriptionMealChoice::query()
            ->where('subscription_id', $subscriptionId)
            ->orderBy('slot')
            ->orderBy('sequence')
            ->get();
    }

    /**
     * @param  Collection<int, SubscriptionMealChoice>  $rows
     * @return array<string, list<SubscriptionMealChoice>>
     */
    private function groupByDate(Collection $rows): array
    {
        $grouped = [];

        foreach ($rows as $row) {
            $grouped[$row->delivery_date->toDateString()][] = $row;
        }

        return $grouped;
    }
}
