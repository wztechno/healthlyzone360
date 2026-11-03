<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\DishOptions;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
use Healthy360\Kitchens\Models\BranchClosure;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Presenters\MarketplaceKitchenPresenter;
use Healthy360\Kitchens\Presenters\MarketplaceMealPresenter;
use Healthy360\Kitchens\Presenters\MarketplacePlanPresenter;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\ReferenceData\Models\DeliveryArea;

/**
 * Turns rows into the wire shapes, and reads each kitchen's shared context
 * exactly once per request.
 *
 * A page of meals from three kitchens needs three sets of branches, three
 * opening weeks, three channel lists and three calendars — not twenty-five.
 * The cache below is per-instance and the instance is per-request (the
 * controllers resolve it from the container and hold it for one call), so
 * nothing is remembered across requests and there is no invalidation problem to
 * get wrong.
 *
 * It is a projector rather than a repository: it never decides *which* rows a
 * caller may see. That decision lives in `MarketplaceKitchens::visible()`,
 * `MarketplaceMeals::visible()` and `MarketplacePlans::visible()`, in SQL, once
 * each.
 */
final class MarketplaceProjector
{
    /**
     * @var array<string, array{
     *     kitchen: Organisation|null,
     *     branches: list<OrganisationBranch>,
     *     hours: list<BranchOpeningHour>,
     *     windows: list<DeliveryWindow>,
     *     zones: array<string, list<array{zone: DeliveryZone, areas: list<DeliveryArea>, window_codes: list<string>}>>,
     *     channels: array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool},
     *     listing_channels: list<SalesChannel>,
     *     availability: list<array{date: string, available: bool, remaining: int|null, order_cut_off_at: string|null}>
     * }>
     */
    private array $context = [];

    /**
     * Each meal's own calendar days, keyed by meal id; read a page at a time.
     *
     * @var array<string, array<string, array{available: bool, remaining: int|null}>>
     */
    private array $mealDays = [];

    public function __construct(
        private readonly MarketplaceKitchens $kitchens,
        private readonly MarketplaceMeals $meals,
        private readonly MarketplacePlans $plans,
        private readonly MarketplaceAvailability $availability,
        private readonly MarketplaceKitchenPresenter $kitchenPresenter,
        private readonly MarketplaceMealPresenter $mealPresenter,
        private readonly MarketplacePlanPresenter $planPresenter,
        private readonly DishOptions $dishOptions,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function kitchen(Organisation $kitchen, string $locale): array
    {
        $context = $this->contextFor($kitchen);

        $branches = array_map(
            static fn (OrganisationBranch $branch): array => [
                'branch' => $branch,
                'zones' => $context['zones'][(string) $branch->getKey()] ?? [],
                'hours' => array_values(array_filter(
                    $context['hours'],
                    static fn ($day): bool => $day->branch_id === (string) $branch->getKey(),
                )),
            ],
            $context['branches'],
        );

        return $this->kitchenPresenter->kitchen(
            $kitchen,
            $locale,
            $this->meals->dietClassificationCodesOfKitchen((string) $kitchen->getKey()),
            $context['channels'],
            $branches,
            $context['windows'],
        );
    }

    /**
     * One meal, or **null** when it has no price.
     *
     * The null is the exclusion rule of the whole meal surface, expressed once:
     * an unpriced meal is not sellable, the consumer contract has no shape for
     * one, and `MarketplacePage` drops whatever this rejects.
     *
     * @param  list<string>  $excludeAllergens  reject the meal if it carries any of these
     * @return array<string, mixed>|null
     */
    public function meal(CatalogueItem $meal, string $locale, array $excludeAllergens = [], ?string $availableOn = null): ?array
    {
        return $this->projectMeal($meal, $locale, $excludeAllergens, $availableOn);
    }

    /**
     * Read the per-meal calendar days of a whole batch of meals in one query,
     * before they are projected one by one. A meal nobody primed is read on its
     * own when it is projected, so the detail page needs no call.
     *
     * @param  list<CatalogueItem>  $meals
     */
    public function primeMeals(array $meals): void
    {
        $ids = array_values(array_diff(
            array_map(static fn (CatalogueItem $meal): string => (string) $meal->getKey(), $meals),
            array_keys($this->mealDays),
        ));

        if ($ids === []) {
            return;
        }

        // A day either side of the server's today: every kitchen's fortnight
        // starts on its own branch's today, which can be the server's yesterday
        // or tomorrow.
        $byMeal = $this->meals->availabilityByMeal(
            $ids,
            CarbonImmutable::now()->subDay(),
            MarketplaceAvailability::WINDOW_DAYS + 2,
        );

        foreach ($ids as $id) {
            $this->mealDays[$id] = $byMeal[$id] ?? [];
        }
    }

    /**
     * The detail page's meal: {@see meal()} and what the customer can choose. Not
     * on the listing, which would pay for a dozen price reads nobody looks at.
     *
     * @return array<string, mixed>|null
     */
    public function mealWithChoices(CatalogueItem $meal, string $locale): ?array
    {
        $projected = $this->projectMeal($meal, $locale, [], null);

        if ($projected === null) {
            return null;
        }

        return $projected + [
            'options' => $this->dishOptions->forItem((string) $meal->getKey()),
            'portions' => $this->meals->portionsOf($meal, $this->contextFor($meal->organisation_id)['listing_channels']),
        ];
    }

    /**
     * @param  list<string>  $excludeAllergens
     * @return array<string, mixed>|null
     */
    private function projectMeal(CatalogueItem $meal, string $locale, array $excludeAllergens, ?string $availableOn): ?array
    {
        $context = $this->contextFor($meal->organisation_id);

        if ($context['kitchen'] === null) {
            return null;
        }

        $price = $this->meals->priceOf($meal, $context['listing_channels']);

        if (! $price instanceof ResolvedPrice) {
            return null;
        }

        $allergens = $this->meals->allergenCodesOf($meal);

        if ($excludeAllergens !== [] && array_intersect($allergens, $excludeAllergens) !== []) {
            return null;
        }

        $availability = $this->withMealDays($context['availability'], $meal);

        if ($availableOn !== null && ! $this->isAvailableOn($availability, $availableOn)) {
            return null;
        }

        return $this->mealPresenter->meal(
            $meal,
            $context['kitchen']->name,
            $locale,
            $price,
            $this->meals->packSizeOf($meal, $price),
            $allergens,
            $this->meals->nutritionOf($meal),
            $this->meals->dietClassificationCodesOf($meal),

            // What the kitchen ticked on the item (HA-35); never guessed from
            // the name.
            array_values($meal->meal_types ?? []),
            $context['channels'],
            $availability,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function plan(CatalogueItem $plan, string $locale): array
    {
        $profile = $this->plans->profileOf($plan);
        $configurations = $this->plans->configurationsOf($plan, $profile?->pricing_basis);
        $offered = $this->plans->durationsOf($configurations);

        // The whole-run price needs a daily price, and a plan-level duration can
        // only carry one when every configuration offering it agrees — the same
        // rule the discount follows, for the same reason.
        $daily = count($configurations) === 1 ? $configurations[0]['daily'] : null;

        $durations = array_map(
            fn (array $duration): array => [
                'duration' => $duration['duration'],
                'discount_percent' => $duration['discount_percent'],
                'total_price' => $duration['ambiguous']
                    ? null
                    : $this->plans->totalFor($daily, $duration['duration'], $duration['discount_percent']),
            ],
            $offered,
        );

        return $this->planPresenter->plan(
            $plan,
            $profile,
            $locale,
            $this->meals->dietClassificationCodesOf($plan),
            $configurations,
            $durations,
        );
    }

    /**
     * Everything about a kitchen that a page of its items shares.
     *
     * @return array{
     *     kitchen: Organisation|null,
     *     branches: list<OrganisationBranch>,
     *     hours: list<BranchOpeningHour>,
     *     windows: list<DeliveryWindow>,
     *     zones: array<string, list<array{zone: DeliveryZone, areas: list<DeliveryArea>, window_codes: list<string>}>>,
     *     channels: array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool},
     *     listing_channels: list<SalesChannel>,
     *     availability: list<array{date: string, available: bool, remaining: int|null, order_cut_off_at: string|null}>
     * }
     */
    private function contextFor(Organisation|string $kitchen): array
    {
        $id = $kitchen instanceof Organisation ? (string) $kitchen->getKey() : $kitchen;

        if (isset($this->context[$id])) {
            return $this->context[$id];
        }

        $organisation = $kitchen instanceof Organisation
            ? $kitchen
            : $this->kitchens->visible()->whereKey($id)->first();

        if (! $organisation instanceof Organisation) {
            return $this->context[$id] = [
                'kitchen' => null,
                'branches' => [],
                'hours' => [],
                'windows' => [],
                'zones' => [],
                'channels' => MarketplaceChannels::none(),
                'listing_channels' => [],
                'availability' => [],
            ];
        }

        $branches = $this->kitchens->branchesOf($organisation);
        $hours = $this->kitchens->openingHoursOf($organisation, $branches);

        return $this->context[$id] = [
            'kitchen' => $organisation,
            'branches' => $branches,
            'hours' => $hours,
            'windows' => $this->kitchens->deliveryWindowsOf($organisation),
            'zones' => $this->kitchens->deliveryZonesOf($organisation, $branches),
            'channels' => MarketplaceChannels::switchesFor(MarketplaceChannels::activeFor($id)),
            'listing_channels' => $this->meals->listingChannelsOf($id),
            'availability' => $this->availability->calendar($branches, $hours, $this->closuresOf($branches)),
        ];
    }

    /**
     * Every closure of these branches not yet over, in one query. The table's
     * read policy is open (its migration says why), so the anonymous
     * marketplace sees the same closures placement refuses on.
     *
     * @param  list<OrganisationBranch>  $branches
     * @return list<BranchClosure>
     */
    private function closuresOf(array $branches): array
    {
        if ($branches === []) {
            return [];
        }

        return array_values(BranchClosure::withoutTenancy()
            ->whereIn('branch_id', array_map(static fn (OrganisationBranch $branch): string => (string) $branch->getKey(), $branches))
            ->where('closed_to', '>=', now()->subDay()->toDateString())
            ->get()
            ->all());
    }

    /**
     * The kitchen's calendar with the meal's own days laid over it, the rule
     * `LineProbe` refuses on: a day off or a sold-out day is unavailable even
     * when the kitchen is open, and a counted day publishes what is left.
     *
     * @param  list<array{date: string, available: bool, remaining: int|null, order_cut_off_at: string|null}>  $calendar
     * @return list<array{date: string, available: bool, remaining: int|null, order_cut_off_at: string|null}>
     */
    private function withMealDays(array $calendar, CatalogueItem $meal): array
    {
        $id = (string) $meal->getKey();

        if (! isset($this->mealDays[$id])) {
            $this->primeMeals([$meal]);
        }

        $days = $this->mealDays[$id];

        return array_map(static function (array $day) use ($days): array {
            $own = $days[$day['date']] ?? null;

            if ($own === null) {
                return $day;
            }

            $available = $day['available'] && $own['available'];

            return [
                'date' => $day['date'],
                'available' => $available,
                'remaining' => $own['remaining'],
                'order_cut_off_at' => $available ? $day['order_cut_off_at'] : null,
            ];
        }, $calendar);
    }

    /**
     * @param  list<array{date: string, available: bool, remaining: int|null, order_cut_off_at: string|null}>  $calendar
     */
    private function isAvailableOn(array $calendar, string $date): bool
    {
        foreach ($calendar as $day) {
            if ($day['date'] === $date) {
                return $day['available'];
            }
        }

        // Outside the published fortnight the platform has not said, and a
        // filter cannot be answered "yes" on a day nobody has planned.
        return false;
    }
}
