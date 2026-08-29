<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\Scopes\OrganisationScope;
use Illuminate\Database\Eloquent\Builder;

/**
 * The published sellable catalogue a customer can see on the marketplace, and
 * what each listing costs.
 *
 * ## What makes a listing public
 *
 * Four conditions, and every one of them is somebody's decision rather than an
 * inference:
 *
 * 1. **`item_type` is `meal` or `product`.** Subscription plans share the table
 *    and have their own surface. Kitchens sell dishes *and* packaged goods
 *    (sauces, frozen packs, oils); both must be discoverable here when published.
 * 2. **`status = published`.** `CatalogueItemStatus::isConsumerVisible()` is the
 *    predicate, called rather than re-spelled, so a draft, a quarantined item
 *    (`review_required`) and a retired one are all invisible for the same
 *    reason and cannot drift apart.
 * 3. **Offered through a listing channel today.** A row in
 *    `channel_catalogue_items` marked available, inside its own dates, on an
 *    active channel of a listing kind. Publication and availability are
 *    different questions — a complete, published, sellable item that no channel
 *    offers is not on sale — and this is the second one.
 * 4. **It has a price.** Not a filter a caller can turn off: the consumer
 *    contract types `price` as a `Money`, an unpriced item is not sellable, and
 *    the alternatives are both worse than exclusion. Rendering `0` would be a
 *    lie about the price; widening the contract to a nullable price would push
 *    "we do not know what this costs" onto every consumer surface that has no
 *    way to act on it. A placeholder row and a market-priced row resolve to no
 *    price at all (`PriceResolver` makes the three indistinguishable on
 *    purpose), so an item a kitchen has not finished pricing simply does not
 *    appear — which is the same answer the kitchen's own readiness gate gives.
 *
 * ## Where the price comes from
 *
 * `PriceResolver`, through the same channels that made the item visible, in the
 * kitchen's own channel order, first answer wins. The channels are restricted
 * to `MarketplaceChannels::listingKinds()`, which is a subset of the kinds the
 * domain declares non-private, so a negotiated wholesale or corporate tariff is
 * unreachable from here **structurally** rather than by a filter somebody has
 * to remember. The resolved row's `price_list_id` and `price_list_item_id` are
 * dropped by the presenter: they are internal identifiers, and C1's order
 * snapshot is where they belong.
 *
 * `price_list_items` carries a row-level-security policy, so every resolution
 * runs inside `DatabaseTenantContext::during()` scoped to the kitchen being
 * priced. Under the runtime role that is what makes the read possible at all;
 * under the owner role it is what makes the test suite prove the same path.
 */
final readonly class MarketplaceMeals
{
    /** @var list<string> */
    public const array LISTING_ITEM_TYPES = ['meal', 'product', 'sauce', 'dressing'];

    public function __construct(
        private PriceResolver $prices,
        private DerivedAllergenService $allergens,
        private DatabaseTenantContext $tenantContext,
    ) {}

    /**
     * Every meal or product a customer may see, unordered.
     *
     * @return Builder<CatalogueItem>
     */
    public function visible(): Builder
    {
        return CatalogueItem::withoutTenancy()
            // The category relation must opt out too: this query serves the
            // anonymous marketplace, where no tenant context exists to scope
            // the (platform-rowed) product_categories table.
            ->with(['category' => fn ($query) => $query->withoutGlobalScope(OrganisationScope::class)])
            ->whereIn('item_type', self::LISTING_ITEM_TYPES)
            ->where('status', CatalogueItemStatus::Published->value)
            ->whereIn('organisation_id', app(MarketplaceKitchens::class)->visible()->select('organisations.id'))
            ->whereExists(fn ($query) => $query->from('channel_catalogue_items')
                ->join('sales_channels', 'sales_channels.id', '=', 'channel_catalogue_items.sales_channel_id')
                ->whereColumn('channel_catalogue_items.catalogue_item_id', 'catalogue_items.id')
                ->where('channel_catalogue_items.is_available', true)
                ->where('sales_channels.status', 'active')
                ->whereIn('sales_channels.channel_kind', MarketplaceChannels::listingKindValues())
                ->where(fn ($dates) => $dates->whereNull('channel_catalogue_items.available_from')
                    ->orWhere('channel_catalogue_items.available_from', '<=', CarbonImmutable::now()->toDateString()))
                ->where(fn ($dates) => $dates->whereNull('channel_catalogue_items.available_to')
                    ->orWhere('channel_catalogue_items.available_to', '>=', CarbonImmutable::now()->toDateString())));
    }

    /**
     * Restrict to one or more listing item types (`meal`, `product`).
     *
     * @param  Builder<CatalogueItem>  $query
     * @param  list<string>  $types
     */
    /**
     * Only items published under this category, by the platform category's
     * code. An unknown code matches nothing rather than erroring: the codes
     * are navigation, and a stale chip should show an empty shelf, not a 400.
     *
     * @param  Builder<CatalogueItem>  $query
     */
    public function whereCategorySlug(Builder $query, string $slug): void
    {
        $query->whereExists(fn ($sub) => $sub->from('product_categories')
            ->whereColumn('product_categories.id', 'catalogue_items.product_category_id')
            ->where('product_categories.code', $slug)
            ->where('product_categories.is_active', true));
    }

    public function whereItemTypes(Builder $query, array $types): void
    {
        $allowed = array_values(array_intersect(array_unique($types), self::LISTING_ITEM_TYPES));

        if ($allowed === []) {
            $query->whereRaw('false');

            return;
        }

        $query->whereIn('item_type', $allowed);
    }

    /**
     * Free-text over both name columns and both description columns.
     *
     * Both languages, not merely the one being served: a person typing an
     * Arabic dish name into an English interface is searching for the dish, not
     * for a translation of it.
     *
     * @param  Builder<CatalogueItem>  $query
     */
    public function whereTextMatches(Builder $query, string $term): void
    {
        $escaped = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $term).'%';

        $query->where(function (Builder $scoped) use ($escaped): void {
            $scoped->where('name_en', 'ilike', $escaped)
                ->orWhere('name_ar', 'ilike', $escaped)
                ->orWhere('description_en', 'ilike', $escaped)
                ->orWhere('description_ar', 'ilike', $escaped);
        });
    }

    /**
     * Meals carrying **every** one of these diet classifications.
     *
     * `every`, not `any`: a person who ticks vegan *and* gluten-free is stating
     * two requirements, and returning dishes that satisfy one of them is the
     * kind of helpfulness that ends in a returned meal.
     *
     * @param  Builder<CatalogueItem>  $query
     * @param  list<string>  $codes
     */
    public function whereDietClassifications(Builder $query, array $codes): void
    {
        $ids = DietClassification::query()
            ->whereIn('code', $codes)
            ->where('is_active', true)
            ->pluck('id')
            ->all();

        if (count($ids) !== count(array_unique($codes))) {
            // One of the codes is not a classification the platform publishes,
            // so nothing can carry it. Refusing to match beats matching on the
            // subset the caller happened to spell correctly.
            $query->whereRaw('false');

            return;
        }

        foreach ($ids as $id) {
            $query->whereExists(fn ($exists) => $exists->from('catalogue_item_diet_classifications')
                ->whereColumn('catalogue_item_diet_classifications.catalogue_item_id', 'catalogue_items.id')
                ->where('catalogue_item_diet_classifications.diet_classification_id', $id));
        }
    }

    /**
     * The consumer channels a kitchen lists through, in its own order.
     *
     * @return list<SalesChannel>
     */
    public function listingChannelsOf(string $organisationId): array
    {
        return array_values(MarketplaceChannels::activeFor($organisationId)
            ->filter(static fn (SalesChannel $channel): bool => in_array(
                $channel->channel_kind,
                MarketplaceChannels::listingKinds(),
                true,
            ))
            ->all());
    }

    /**
     * What one meal or product costs, or null when nothing prices it.
     *
     * Meals are priced at item level. Products from the workbook are priced on
     * pack variants; {@see PriceResolver} deliberately refuses to invent an
     * article price from a pack row, so the pack choice happens here.
     *
     * Dual-pack rows (retail gram pack on B2C, kilo pack on B2B) often mark the
     * wholesale pack as `is_default` because it is first on the sheet. The
     * consumer listing must still find the pack that actually has a public
     * tariff — try the default first, then every other active pack, then the
     * item-level row — rather than vanishing a sellable product.
     *
     * @param  list<SalesChannel>  $channels
     */
    public function priceOf(CatalogueItem $meal, array $channels): ?ResolvedPrice
    {
        if ($channels === []) {
            return null;
        }

        $variantIds = $meal->item_type->variantType() === VariantType::Pack
            ? $this->listingPackVariantIds($meal)
            : [null];

        return $this->tenantContext->during(null, $meal->organisation_id, null, function () use ($meal, $channels, $variantIds): ?ResolvedPrice {
            foreach ($variantIds as $variantId) {
                foreach ($channels as $channel) {
                    $price = $this->prices->currentFor(
                        (string) $channel->getKey(),
                        (string) $meal->getKey(),
                        $variantId,
                    );

                    if ($price instanceof ResolvedPrice) {
                        return $price;
                    }
                }
            }

            return null;
        });
    }

    /**
     * Packs to try for an unattended consumer price, default first.
     *
     * @return list<string|null>
     */
    private function listingPackVariantIds(CatalogueItem $item): array
    {
        $ids = array_values(CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $item->getKey())
            ->where('status', VariantStatus::Active->value)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());

        // Item-level rows are rare for products but remain a valid last resort.
        $ids[] = null;

        return $ids;
    }

    /**
     * The meal's allergen codes, as a customer's filter reads them.
     *
     * **Both containment levels are included.** `DerivedAllergenService`
     * distinguishes "contains" from "may contain", and a consumer allergen list
     * that dropped the second would let a filter for "no peanuts" return a dish
     * made in a kitchen that cannot rule peanuts out. For a preference that
     * would be over-cautious; for an allergy it is the only safe direction to
     * be wrong in.
     *
     * A meal whose derivation has no basis at all reports an empty list — and
     * cannot reach this method anyway, because the readiness gate refuses to
     * publish a meal that can say nothing about what is in it.
     *
     * @return list<string>
     */
    public function allergenCodesOf(CatalogueItem $meal): array
    {
        $derived = $this->allergens->forItem($meal);

        $codes = array_map(
            static fn (array $row): string => $row['allergen_code'],
            $derived['allergens'],
        );

        $unique = array_values(array_unique($codes));
        sort($unique);

        return $unique;
    }

    /**
     * The meal's diet classification codes.
     *
     * @return list<string>
     */
    public function dietClassificationCodesOf(CatalogueItem $meal): array
    {
        return $this->codesFor(array_values(CatalogueItemDietClassification::withoutTenancy()
            ->where('catalogue_item_id', $meal->getKey())
            ->pluck('diet_classification_id')
            ->all()));
    }

    /**
     * Every diet classification the kitchen's published meals carry — the
     * kitchen-level summary the marketplace card shows.
     *
     * Derived from the meals rather than stored on the organisation, because
     * nothing on `organisations` records how a kitchen cooks, and a column
     * nobody maintains would be wrong within a month.
     *
     * @return list<string>
     */
    public function dietClassificationCodesOfKitchen(string $organisationId): array
    {
        $ids = CatalogueItemDietClassification::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('catalogue_item_id', $this->visible()->where('organisation_id', $organisationId)->select('catalogue_items.id'))
            ->pluck('diet_classification_id')
            ->all();

        return $this->codesFor(array_values($ids));
    }

    /**
     * @param  list<mixed>  $classificationIds
     * @return list<string>
     */
    private function codesFor(array $classificationIds): array
    {
        if ($classificationIds === []) {
            return [];
        }

        /** @var list<string> $codes */
        $codes = DietClassification::query()
            ->whereIn('id', array_values(array_unique(array_map(strval(...), $classificationIds))))
            ->where('is_active', true)
            ->orderBy('display_order')
            ->orderBy('code')
            ->pluck('code')
            ->all();

        return $codes;
    }
}
