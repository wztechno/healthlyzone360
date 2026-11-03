<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Services;

use Carbon\CarbonImmutable;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemAvailabilityDay;
use Healthy360\Catalogues\Models\CatalogueItemDietClassification;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\SalesChannel;
use Healthy360\Catalogues\Services\CatalogueItemService;
use Healthy360\Catalogues\Services\DerivedAllergenService;
use Healthy360\Catalogues\Services\DerivedNutritionService;
use Healthy360\Pricing\Services\PriceResolver;
use Healthy360\Pricing\Services\ResolvedPrice;
use Healthy360\ReferenceData\Models\DietClassification;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Healthy360\Tenancy\Scopes\OrganisationScope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * The published sellable catalogue a customer can see on the marketplace, and
 * what each listing costs.
 *
 * ## What makes a listing public
 *
 * Five conditions, and every one of them is somebody's decision rather than an
 * inference:
 *
 * 1. **`item_type` is anything but a plan** — meal, product, sauce, dressing or
 *    frozen meal. Subscription plans share the table and have their own surface.
 *    Kitchens sell dishes *and* packaged goods (sauces, frozen packs, oils); all
 *    must be discoverable here when published.
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
 * * 5. **Somebody has assessed it for allergens.** The listing shows "None
 *    declared" for an empty label, which reads as safe, so a dish nobody checked
 *    cannot be listed. In SQL, through {@see CatalogueItem::scopeAllergensAssessed()},
 *    which also answers correctly here with no tenant context.
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
    public const array LISTING_ITEM_TYPES = ['meal', 'product', 'sauce', 'dressing', 'frozen_meal'];

    public function __construct(
        private PriceResolver $prices,
        private DerivedAllergenService $allergens,
        private DerivedNutritionService $nutrition,
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
            ->allergensAssessed()
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

    /**
     * @param  Builder<CatalogueItem>  $query
     * @param  list<string>  $types
     */
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
            $query->whereExists(function (QueryBuilder $exists) use ($id): void {
                $exists->from('catalogue_item_diet_classifications')
                    ->whereColumn('catalogue_item_diet_classifications.catalogue_item_id', 'catalogue_items.id')
                    ->where('catalogue_item_diet_classifications.diet_classification_id', $id);

                self::withoutContradictedFreeFrom($exists);
            });
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
     * Most meals are priced at item level; products, sauces and meals sold by
     * weight are priced on pack variants. {@see PriceResolver} deliberately
     * refuses to invent an article price from a pack row, so the pack choice
     * happens here — and an item with no pack falls through to its item-level
     * row.
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
     * The portions a customer can pick between: every active pack with a price on
     * these channels. Empty unless there are two, because one is no choice. The
     * pack is the portion, so its price is its price-list row and a chosen one
     * reaches the order as `catalogue_item_variant_id`, as any pack does.
     *
     * @param  list<SalesChannel>  $channels
     * @return list<array{catalogue_item_variant_id: string, name_en: string, name_ar: string, unit_price_minor: int, currency_code: string}>
     */
    public function portionsOf(CatalogueItem $meal, array $channels): array
    {
        $packs = CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $meal->getKey())
            ->where('status', VariantStatus::Active->value)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->get();

        if ($packs->count() < 2) {
            return [];
        }

        $portions = $this->tenantContext->during(null, $meal->organisation_id, null, function () use ($meal, $channels, $packs): array {
            $priced = [];

            foreach ($packs as $pack) {
                foreach ($channels as $channel) {
                    $price = $this->prices->currentFor((string) $channel->getKey(), (string) $meal->getKey(), (string) $pack->getKey());

                    if ($price instanceof ResolvedPrice) {
                        $priced[] = [
                            'catalogue_item_variant_id' => (string) $pack->getKey(),
                            'name_en' => $pack->name_en ?? $pack->code,
                            'name_ar' => $pack->name_ar ?? $pack->name_en ?? $pack->code,
                            'unit_price_minor' => $price->amountMinor,
                            'currency_code' => $price->currencyCode,
                        ];

                        break;
                    }
                }
            }

            return $priced;
        });

        return count($portions) < 2 ? [] : $portions;
    }

    /**
     * The size the resolved price buys — `0.3 kg` for a sauce's B2C bottle —
     * or null when the price is an item-level row.
     *
     * Read from the price itself rather than re-chosen, so the size shown can
     * never belong to a different pack than the number beside it. Inside the
     * kitchen's tenant context for the same reason as {@see priceOf()}.
     *
     * @return array{size: string, unit: string}|null
     */
    public function packSizeOf(CatalogueItem $item, ResolvedPrice $price): ?array
    {
        return $this->tenantContext->during(
            null,
            $item->organisation_id,
            null,
            static fn (): ?array => CatalogueItemPackVariant::sizeOf($price->catalogueItemVariantId),
        );
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
     * **Inside the kitchen's tenant context, for {@see nutritionOf()}'s reason
     * and with the same consequence.** `DerivedAllergenService` prefers the
     * published recipe version's frozen label and falls back to the item's own
     * linked ingredients. `recipe_versions` is a tenant row whose row-level
     * policy fails closed for a request with no organisation, so an anonymous
     * marketplace read could not see the frozen label at all: it silently took
     * the weaker basis, and a label frozen at publication is precisely the one
     * an allergy sufferer is entitled to. The test suite cannot catch this
     * because it runs as the schema owner, which the policies do not apply to —
     * which is why the wrap is here rather than waiting for a red test.
     *
     * @return list<string>
     */
    public function allergenCodesOf(CatalogueItem $meal): array
    {
        /** @var list<string> $codes */
        $codes = $this->tenantContext->during(null, $meal->organisation_id, null, function () use ($meal): array {
            $derived = $this->allergens->forItem($meal);

            return array_map(
                static fn (array $row): string => $row['allergen_code'],
                $derived['allergens'],
            );
        });

        $unique = array_values(array_unique($codes));
        sort($unique);

        return $unique;
    }

    /**
     * The meal's nutrition facts, as a customer's panel reads them.
     *
     * A thin pass-through to {@see DerivedNutritionService}, which holds the
     * authority order — the kitchen's own recorded payload, else the published
     * recipe version's snapshot divided down to one sold unit, else null.
     *
     * **One more `publishedVersion()` lookup per listed item**, on top of the
     * one {@see allergenCodesOf()} already does. Accepted rather than memoised,
     * for the reason that precedent gives: it is a primary-key-shaped read of
     * one row, a page of items is at most a page of them, and a shared memo on
     * the projector would be a cache with a lifetime to reason about in
     * exchange for a query PostgreSQL answers out of the buffer pool. When a
     * listing page's query count becomes the problem, both lookups move
     * together into one eager load — not one of them into a special case.
     *
     * **Inside the kitchen's tenant context, like the price.** The published
     * item is readable by anyone — that is what "published" means to the
     * row-level policy on `catalogue_items` — but the recipe version behind it
     * is the kitchen's own row, and the policy on `recipe_versions` fails
     * closed for a request with no organisation. An anonymous marketplace read
     * would therefore find no version, derive nothing, and answer `null` for a
     * dish whose snapshot is sitting right there; the test suite cannot see
     * this because it runs as the schema owner, which the policies do not
     * apply to. `priceOf()` restores the kitchen's context for the same reason
     * (tariffs are tenant rows), and the projection borrows the same door.
     *
     * @return array<string, mixed>|null
     */
    public function nutritionOf(CatalogueItem $meal): ?array
    {
        return $this->tenantContext->during(null, $meal->organisation_id, null, function () use ($meal): ?array {
            return $this->nutrition->forItem($meal);
        });
    }

    /**
     * Each meal's own calendar days, for a page of meals in one query.
     *
     * The rows `LineProbe::calendarRefusal()` refuses on, read the same way: a
     * day with `is_available` off is a day off, and a counted day with fewer
     * than one portion left is sold out (a listing asks about one portion, the
     * least anyone can order). A date with no row says nothing, so it is absent
     * here and the kitchen's calendar stands. `remaining` is the counted figure,
     * or null when nobody is counting; `order_cut_off_at` is the meal's own
     * clock-face cut-off, which the projector applies on the branch's clock.
     *
     * No tenant context: the table has no row-level policy, only the Eloquent
     * scope `withoutTenancy()` lifts, so the anonymous marketplace reads it as
     * placement does.
     *
     * @param  list<string>  $itemIds
     * @return array<string, array<string, array{available: bool, remaining: int|null, order_cut_off_at: string|null}>>
     */
    public function availabilityByMeal(array $itemIds, CarbonImmutable $from, int $days = MarketplaceAvailability::WINDOW_DAYS): array
    {
        if ($itemIds === []) {
            return [];
        }

        $byMeal = [];

        $rows = CatalogueItemAvailabilityDay::withoutTenancy()
            ->whereIn('catalogue_item_id', $itemIds)
            ->whereBetween('date', [$from->toDateString(), $from->addDays($days - 1)->toDateString()])
            ->get(['catalogue_item_id', 'date', 'is_available', 'remaining_portions', 'order_cut_off_at']);

        foreach ($rows as $row) {
            $remaining = $row->remaining_portions === null ? null : max(0, $row->remaining_portions);

            $byMeal[$row->catalogue_item_id][$row->date->toDateString()] = [
                'available' => $row->is_available && ($remaining === null || $remaining >= 1),
                'remaining' => $remaining,
                'order_cut_off_at' => $row->order_cut_off_at,
            ];
        }

        return $byMeal;
    }

    /**
     * The meal's diet classification codes.
     *
     * @return list<string>
     */
    public function dietClassificationCodesOf(CatalogueItem $meal): array
    {
        $tags = CatalogueItemDietClassification::withoutTenancy()
            ->where('catalogue_item_id', $meal->getKey());

        self::withoutContradictedFreeFrom($tags);

        return $this->codesFor(array_values($tags->pluck('diet_classification_id')->all()));
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
        $tags = CatalogueItemDietClassification::withoutTenancy()
            ->where('organisation_id', $organisationId)
            ->whereIn('catalogue_item_id', $this->visible()->where('organisation_id', $organisationId)->select('catalogue_items.id'));

        self::withoutContradictedFreeFrom($tags);

        return $this->codesFor(array_values($tags->pluck('diet_classification_id')->all()));
    }

    /**
     * Drop every free-from tag its dish's allergen label contradicts, on a query
     * over `catalogue_item_diet_classifications`.
     *
     * Owner, 3 Nov 2026: a dish already on sale loses the tag on the customer
     * side (the kitchen is warned, and can no longer save or publish one). A
     * correlated `NOT EXISTS` inside the query that reads the tags, so the meal
     * list pays no extra round trip for it.
     *
     * The label is {@see allergenCodesOf()}'s, spelt in SQL: the published recipe
     * version's frozen rows when there is a version, else the item's listed
     * ingredients, else the one ingredient it is, each from both mapping layers.
     * Any containment contradicts, and so does the published label of any choice
     * the dish offers (a `nut_free` bowl with a peanut-sauce choice is not nut
     * free). The version is read through
     * `recipe_published_label_has()` because the anonymous marketplace
     * cannot see `recipe_versions`, and a plain join would keep the tag.
     *
     * @param  Builder<CatalogueItemDietClassification>|QueryBuilder  $tags
     */
    private static function withoutContradictedFreeFrom(Builder|QueryBuilder $tags): void
    {
        $pairs = [];
        $bindings = [];

        foreach (CatalogueItemService::FREE_FROM as $tag => $allergenCodes) {
            foreach ($allergenCodes as $allergenCode) {
                $pairs[] = '(?::text, ?::text)';
                $bindings[] = $tag;
                $bindings[] = $allergenCode;
            }
        }

        $values = implode(', ', $pairs);

        $tags->whereRaw(<<<SQL
            NOT EXISTS (
                SELECT 1
                FROM diet_classifications free_from_tag
                JOIN (VALUES {$values}) AS free_from (tag, allergen_code) ON free_from.tag = free_from_tag.code
                JOIN catalogue_items tagged ON tagged.id = catalogue_item_diet_classifications.catalogue_item_id
                WHERE free_from_tag.id = catalogue_item_diet_classifications.diet_classification_id
                  AND (COALESCE(
                      recipe_published_label_has(tagged.recipe_id, tagged.organisation_id, ARRAY[free_from.allergen_code]),
                      CASE
                          WHEN EXISTS (SELECT 1 FROM catalogue_item_ingredients listed WHERE listed.catalogue_item_id = tagged.id)
                          THEN EXISTS (
                              SELECT 1
                              FROM catalogue_item_ingredients listed
                              JOIN ingredient_allergens mapped ON mapped.ingredient_id = listed.ingredient_id
                              WHERE listed.catalogue_item_id = tagged.id
                                AND (mapped.organisation_id IS NULL OR mapped.organisation_id = tagged.organisation_id)
                                AND mapped.allergen_code = free_from.allergen_code
                          )
                          ELSE EXISTS (
                              SELECT 1
                              FROM ingredient_allergens mapped
                              WHERE mapped.ingredient_id = tagged.ingredient_id
                                AND (mapped.organisation_id IS NULL OR mapped.organisation_id = tagged.organisation_id)
                                AND mapped.allergen_code = free_from.allergen_code
                          )
                      END
                  ) OR EXISTS (
                      SELECT 1
                      FROM catalogue_item_options offered
                      WHERE offered.catalogue_item_id = tagged.id
                        AND offered.kind = 'choice'
                        AND offered.recipe_id IS NOT NULL
                        AND recipe_published_label_has(offered.recipe_id, tagged.organisation_id, ARRAY[free_from.allergen_code])
                  ))
            )
            SQL, $bindings);
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
