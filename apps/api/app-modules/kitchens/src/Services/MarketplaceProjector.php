<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Delivery\Models\DeliveryWindow;
use Healthy360\Delivery\Models\DeliveryZone;
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
     *     zones: array<string, list<array{zone: DeliveryZone, areas: list<DeliveryArea>}>>,
     *     channels: array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool},
     *     listing_channels: list<SalesChannel>,
     *     availability: list<array{date: string, available: bool, remaining: null, order_cut_off_at: string|null}>
     * }>
     */
    private array $context = [];

    public function __construct(
        private readonly MarketplaceKitchens $kitchens,
        private readonly MarketplaceMeals $meals,
        private readonly MarketplacePlans $plans,
        private readonly MarketplaceAvailability $availability,
        private readonly MarketplaceKitchenPresenter $kitchenPresenter,
        private readonly MarketplaceMealPresenter $mealPresenter,
        private readonly MarketplacePlanPresenter $planPresenter,
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

        if ($availableOn !== null && ! $this->isAvailableOn($context['availability'], $availableOn)) {
            return null;
        }

        return $this->mealPresenter->meal(
            $meal,
            $context['kitchen']->name,
            $locale,
            $price,
            $allergens,
            $this->meals->dietClassificationCodesOf($meal),

            // Nothing on the item records a meal's time of day; see the
            // presenter for why that stays empty rather than being guessed
            // from the name.
            [],
            $context['channels'],
            $context['availability'],
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
            $this->plans->sampleMealIdsOf($plan, $profile),
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
     *     zones: array<string, list<array{zone: DeliveryZone, areas: list<DeliveryArea>}>>,
     *     channels: array{b2c: bool, b2b: bool, marketplace: bool, pos: bool, subscription: bool, delivery: bool, pickup: bool, corporate: bool},
     *     listing_channels: list<SalesChannel>,
     *     availability: list<array{date: string, available: bool, remaining: null, order_cut_off_at: string|null}>
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
            'availability' => $this->availability->calendar($branches, $hours),
        ];
    }

    /**
     * @param  list<array{date: string, available: bool, remaining: null, order_cut_off_at: string|null}>  $calendar
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
