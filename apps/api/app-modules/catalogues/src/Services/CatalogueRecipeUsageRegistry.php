<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\CatalogueItemStatus;
use Healthy360\Catalogues\Enums\SalesChannelKind;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Kitchens\Services\MarketplaceChannels;
use Healthy360\Recipes\Contracts\RecipeUsageRegistry;
use Healthy360\Recipes\Models\Recipe;
use Healthy360\Recipes\Presenters\RecipeAdminPresenter;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\DB;

/**
 * The catalogues module's answer to "what else is selling this recipe" — and,
 * since K1.8, the hand that takes those listings off sale when the recipe's
 * allergen label moves underneath them.
 *
 * Bound by `CataloguesServiceProvider`, replacing the recipes module's null
 * implementation. The direction of the dependency is the point: recipes ask,
 * catalogues answer, and the module graph stays Catalogues → Recipes with no
 * cycle. That the second question *writes* does not change the direction —
 * the recipes module still says only "this label changed", and what a listing
 * does about it is a catalogue decision made here.
 *
 * **Published items only**, in both answers. A draft item pointing at a recipe
 * is somebody working on next month's menu; blocking a retirement on it would
 * make drafting a future dish an obstacle to withdrawing a current one, and
 * quarantining it would fill the review queue with work nobody needs to do
 * before service. Only a live listing has a customer behind it, and only a live
 * listing is showing a label derived from the version in question.
 *
 * The recipe book's three questions — what sells these recipes, narrow the book
 * by it, find a recipe by it — are the exception, and on purpose: they list
 * rather than guard, so they see every status.
 *
 * @phpstan-import-type RecipeSeller from RecipeAdminPresenter
 */
final readonly class CatalogueRecipeUsageRegistry implements RecipeUsageRegistry
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @return list<string>
     */
    public function publishedItemIds(Recipe $recipe): array
    {
        if (! $this->context->hasOrganisation()) {
            return [];
        }

        return array_values(CatalogueItem::query()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', CatalogueItemStatus::Published->value)
            ->orderBy('slug')
            ->pluck('id')
            ->map(static fn (mixed $id): string => (string) $id)
            ->all());
    }

    /**
     * Take every live listing of this recipe off sale, because the label
     * underneath it moved (K1.8).
     *
     * Published only, and for the same reason `publishedItemIds()` is: a draft
     * listing is not in front of anybody, and quarantining it would fill the
     * review queue with work nobody needs to do before service. The retired
     * ones are history and stay history.
     *
     * **`lock_version` deliberately does not move.** The gate this quarantine
     * arms is structural — `PublishCatalogueItem` refuses a `review_required`
     * item whatever validator the caller holds — so bumping the validator would
     * buy no safety and would turn every open editor's next save into a
     * spurious `409` for a change they did not make and cannot see.
     *
     * One audit event per item rather than one for the batch: the review queue
     * is worked item by item, and "why is this listing off sale" has to be
     * answerable from that listing's own trail.
     *
     * @return list<string>
     */
    public function quarantinePublishedItems(Recipe $recipe, string $reason): array
    {
        if (! $this->context->hasOrganisation()) {
            return [];
        }

        $items = CatalogueItem::query()
            ->where('recipe_id', $recipe->getKey())
            ->where('status', CatalogueItemStatus::Published->value)
            ->orderBy('slug')
            ->get();

        if ($items->isEmpty()) {
            return [];
        }

        DB::transaction(function () use ($items, $reason): void {
            foreach ($items as $item) {
                CatalogueItem::withoutTenancy()
                    ->whereKey($item->getKey())
                    ->update([
                        'status' => CatalogueItemStatus::ReviewRequired->value,
                        'review_reason' => $reason,
                        'updated_at' => now(),
                    ]);
            }
        });

        foreach ($items as $item) {
            $this->audit->record(
                'catalogue.item_quarantined',
                actorUserId: $this->context->userId(),
                subjectType: 'catalogue_item',
                subjectId: (string) $item->getKey(),
                metadata: [
                    'slug' => $item->slug,
                    'recipe_id' => (string) $recipe->getKey(),
                    'previous_status' => CatalogueItemStatus::Published->value,
                    'origin' => 'allergen_rollup_changed',
                    'review_reason' => $reason,
                ],
            );
        }

        return array_values($items->map(static fn (CatalogueItem $item): string => (string) $item->getKey())->all());
    }

    /**
     * What sells each recipe on a page of the recipe book, keyed by recipe id.
     *
     * Three queries however many recipes are asked about: the items, then their channels and their
     * packs, each grouped by item. Every status, in slug order, the cooked kinds only — see the
     * port for why this one lists retired sellers the two guards above ignore.
     *
     * The tenant scope on `CatalogueItem` is what keeps another kitchen's item out: the recipe ids
     * are this organisation's, and so is every item the scoped query can return.
     *
     * @param  list<string>  $recipeIds
     * @return array<string, list<RecipeSeller>>
     */
    public function sellersByRecipe(array $recipeIds): array
    {
        if ($recipeIds === [] || ! $this->context->hasOrganisation()) {
            return [];
        }

        $items = CatalogueItem::query()
            ->whereIn('recipe_id', $recipeIds)
            ->whereIn('item_type', self::KINDS)
            ->orderBy('slug')
            ->get([
                'id', 'recipe_id', 'item_type', 'status', 'lock_version', 'source_ref', 'slug', 'name_en', 'name_ar',
                'image_placeholder_id', 'kitchen_category', 'kitchen_subcategory', 'is_market_priced', 'is_assorted',
                'data_quality_flags', 'portion_factor', 'composition',
            ]);

        if ($items->isEmpty()) {
            return [];
        }

        $itemIds = [];

        foreach ($items as $item) {
            $itemIds[] = (string) $item->getKey();
        }

        $channels = $this->channelCodes($itemIds);
        $packs = $this->packs($itemIds);

        $sellers = [];

        foreach ($items as $item) {
            $id = (string) $item->getKey();

            $sellers[(string) $item->recipe_id][] = [
                'id' => $id,
                'item_type' => $item->item_type->value,
                'status' => $item->status->value,
                // The item's own validator, so withdrawing it from the book sends the `If-Match`
                // its retire route demands without a second read.
                'lock_version' => $item->lock_version,
                'reference' => $item->source_ref,
                'slug' => $item->slug,
                'name_en' => $item->name_en,
                'name_ar' => $item->name_ar,
                // Resolved the way the admin's item screens and the storefront resolve it — the
                // stored id, else `item_type-slug` — so all three draw the same photograph.
                'image_placeholder_id' => $item->image_placeholder_id ?? $item->item_type->value.'-'.$item->slug,
                'kitchen_category' => $item->kitchen_category,
                'kitchen_subcategory' => $item->kitchen_subcategory,
                'is_market_priced' => $item->is_market_priced,
                'is_assorted' => $item->is_assorted,
                'data_quality_flags' => $item->data_quality_flags ?? [],
                'portion_factor' => (string) $item->portion_factor,
                'composition' => $item->composition,
                'channel_codes' => $channels[$id] ?? [],
                'pack_count' => $packs[$id]['count'] ?? 0,
                'default_pack' => $packs[$id]['default'] ?? null,
            ];
        }

        return $sellers;
    }

    /**
     * Narrow the recipe book by what sells each recipe — the port states the rule; this is it in
     * SQL. `preparation` is the absence of any cooked seller; a kind and a status together are one
     * `EXISTS`, so both have to hold of the same item.
     *
     * A `preparation` asked for with a sale status matches nothing, and says so honestly: nothing
     * sells a preparation, so nothing selling it has a status.
     *
     * @param  Builder<Recipe>  $recipes
     */
    public function constrainBySellers(Builder $recipes, ?string $kind, ?string $sellingStatus): void
    {
        if ($kind === self::PREPARATION) {
            $recipes->whereNotExists(function (QueryBuilder $sub): void {
                $this->sellersOf($sub);
            });
        }

        $cookedKind = $kind === self::PREPARATION ? null : $kind;

        if ($cookedKind === null && $sellingStatus === null) {
            return;
        }

        $recipes->whereExists(function (QueryBuilder $sub) use ($cookedKind, $sellingStatus): void {
            $this->sellersOf($sub);

            if ($cookedKind !== null) {
                $sub->where('ci.item_type', $cookedKind);
            }

            if ($sellingStatus !== null) {
                $sub->where('ci.status', $sellingStatus);
            }
        });
    }

    /**
     * One more `OR` in the recipe search: a selling item's handle or English name. Every status —
     * a recipe found by the name of the sauce it used to be sold as is still that recipe.
     *
     * @param  Builder<covariant Model>  $scoped
     */
    public function orWhereSellerMatches(Builder $scoped, string $needle): void
    {
        $scoped->orWhereExists(function (QueryBuilder $sub) use ($needle): void {
            $this->sellersOf($sub)->where(function (QueryBuilder $match) use ($needle): void {
                $match->whereRaw('lower(ci.source_ref) like ?', [$needle])
                    ->orWhereRaw('lower(ci.name_en) like ?', [$needle]);
            });
        });
    }

    /**
     * The correlated base every seller subquery shares: the cooked items selling the outer
     * `recipes` row, **in that recipe's own organisation**.
     *
     * The organisation is correlated explicitly because nothing else would: `catalogue_items` is
     * scoped by the application rather than by a row-level policy
     * (`2026_08_02_000704_create_catalogue_items_table`), and a raw subquery never passes through
     * the application's scope. Without this line another kitchen's item pointing at a recipe would
     * sell it, match its search and pass its filters — the precedent is the item list's own
     * allergen filter, which correlates `recipe_versions` the same way.
     */
    private function sellersOf(QueryBuilder $sub): QueryBuilder
    {
        return $sub->selectRaw('1')
            ->from('catalogue_items as ci')
            ->whereColumn('ci.recipe_id', 'recipes.id')
            ->whereColumn('ci.organisation_id', 'recipes.organisation_id')
            ->whereIn('ci.item_type', self::KINDS);
    }

    /**
     * The channels each item is available on, keyed by item id — one entry per channel *kind*,
     * however many channel rows or variants carry it, sorted.
     *
     * Stated in the admin's channel vocabulary (`b2c`, `b2b`, `pos`, …) rather than as the
     * kitchen's own channel codes (`web-shop`, `desk`): the book draws the chips the product list
     * drew, and those are kinds. The mapping is `MarketplaceChannels::switchFor()`, the one place it
     * is written down, so an insurer's channel — which has no word there — draws no chip here.
     *
     * "Available" means available **today**: the row's `is_available` switch, and its
     * `available_from` / `available_to` pair read as the inclusive, open-ended window the basket's
     * own check reads it as (`LineProbe::offeredOn`). A chip for a channel whose window closed last
     * month would tell a kitchen the dish is on a menu it has left.
     *
     * @param  list<string>  $itemIds
     * @return array<string, list<string>>
     */
    private function channelCodes(array $itemIds): array
    {
        $today = now()->toDateString();

        $rows = ChannelCatalogueItem::query()
            ->join('sales_channels', 'sales_channels.id', '=', 'channel_catalogue_items.sales_channel_id')
            ->whereIn('channel_catalogue_items.catalogue_item_id', $itemIds)
            ->where('channel_catalogue_items.is_available', true)
            ->where(function (Builder $window) use ($today): void {
                $window->whereNull('channel_catalogue_items.available_from')
                    ->orWhere('channel_catalogue_items.available_from', '<=', $today);
            })
            ->where(function (Builder $window) use ($today): void {
                $window->whereNull('channel_catalogue_items.available_to')
                    ->orWhere('channel_catalogue_items.available_to', '>=', $today);
            })
            ->distinct()
            ->toBase()
            ->get(['channel_catalogue_items.catalogue_item_id', 'sales_channels.channel_kind']);

        /** @var array<string, array<string, string>> $sets */
        $sets = [];

        foreach ($rows as $row) {
            $kind = SalesChannelKind::tryFrom((string) $row->channel_kind);
            $code = $kind === null ? null : MarketplaceChannels::switchFor($kind);

            if ($code !== null) {
                $sets[(string) $row->catalogue_item_id][$code] = $code;
            }
        }

        $codes = [];

        foreach ($sets as $itemId => $set) {
            ksort($set);
            $codes[$itemId] = array_values($set);
        }

        return $codes;
    }

    /**
     * How many packs each item is sold in, and the one the book shows, keyed by item id.
     *
     * The default is the variant flagged default, else the first by code — the order the rows are
     * read in, so the first row per item is the answer. Archived packs are neither counted nor
     * shown: removing a pack from an item archives it, and a list that went on counting it would
     * disagree with the editor it was removed in. An item with no pack is absent, which reads as
     * `pack_count: 0` and `default_pack: null`.
     *
     * @param  list<string>  $itemIds
     * @return array<string, array{count: int, default: array{label_en: string, label_ar: string|null, net_quantity: string, net_unit_code: string|null}}>
     */
    private function packs(array $itemIds): array
    {
        $rows = CatalogueItemVariant::query()
            ->join('catalogue_item_pack_variants', 'catalogue_item_pack_variants.catalogue_item_variant_id', '=', 'catalogue_item_variants.id')
            ->leftJoin('measurement_units', 'measurement_units.id', '=', 'catalogue_item_pack_variants.pack_unit_id')
            ->whereIn('catalogue_item_variants.catalogue_item_id', $itemIds)
            ->where('catalogue_item_variants.status', '!=', VariantStatus::Archived->value)
            ->orderBy('catalogue_item_variants.catalogue_item_id')
            ->orderByDesc('catalogue_item_variants.is_default')
            ->orderBy('catalogue_item_variants.code')
            ->toBase()
            ->get([
                'catalogue_item_variants.catalogue_item_id',
                'catalogue_item_variants.code',
                'catalogue_item_variants.name_en',
                'catalogue_item_variants.name_ar',
                'catalogue_item_pack_variants.pack_quantity',
                'measurement_units.code as unit_code',
            ]);

        $packs = [];

        foreach ($rows as $row) {
            $itemId = (string) $row->catalogue_item_id;

            if (isset($packs[$itemId])) {
                $packs[$itemId]['count']++;

                continue;
            }

            $packs[$itemId] = [
                'count' => 1,
                'default' => [
                    // The pack's name, else its code — the label the product editor draws.
                    'label_en' => is_string($row->name_en) ? $row->name_en : (string) $row->code,
                    'label_ar' => is_string($row->name_ar) ? $row->name_ar : null,
                    'net_quantity' => (string) $row->pack_quantity,
                    'net_unit_code' => is_string($row->unit_code) ? $row->unit_code : null,
                ],
            ];
        }

        return $packs;
    }
}
