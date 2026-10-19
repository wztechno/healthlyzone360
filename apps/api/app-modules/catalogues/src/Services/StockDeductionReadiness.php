<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Catalogues\Enums\CatalogueItemType;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Ingredients\Models\Ingredient;
use Healthy360\Recipes\Enums\RecipeVersionStatus;
use Healthy360\Recipes\Models\RecipeVersion;
use Healthy360\ReferenceData\Models\MeasurementUnit;

/**
 * Whether selling this item can take anything off a shelf (HA-45) — the setup half of
 * the question the order consumption path answers at confirm time.
 *
 * A confirmed order never refuses on stock math: a sale the consume path cannot
 * resolve is recorded as a Stock gaps row and the shelf stays where it was. That is
 * right for a shelf that is merely empty — a buying problem — and wrong for a listing
 * that was never set up to deduct at all, because then *every* sale is silent. These
 * are the setup facts, read from the catalogue and recipe side only, that make every
 * sale of an item a non-deduction:
 *
 * - **A meal cooked when ordered** explodes its recipe, so it needs a recipe
 *   (`stock_no_recipe`), a published version of it (`stock_recipe_not_published`), and
 *   a piece count on that version to divide one portion out of the batch
 *   (`stock_no_pieces_produced`).
 * - **Anything sold from finished stock** — a frozen meal, sauce, dressing, or a meal
 *   made in advance — draws its own shelf, so it must name the produced item
 *   (`stock_no_shelf`) and, where that shelf is counted by weight or volume, say how
 *   much one sale takes (`stock_no_amount_per_sale`): a net content, or a pack whose
 *   size an order line snapshots. A shelf counted in pieces needs neither.
 *
 * A resale **product** with no ingredient link is not asked: a bought-in good the
 * kitchen does not track is a legitimate listing, not a broken one.
 *
 * The shelf's unit is read off the ingredient's `default_unit_id`, the same fact
 * {@see CatalogueItemService::requireNetContentOnAWeighedShelf()} reads, so Catalogues
 * does not depend on Inventory for a guard. Silent where the unit is unknown.
 *
 * Used twice: {@see CatalogueItemReadiness} refuses to publish an item with any of
 * these, and the admin wire shapes carry them as `stock_blockers` so a listing already
 * on sale shows what to fix.
 */
final readonly class StockDeductionReadiness
{
    /**
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    public function reasons(CatalogueItem $item): array
    {
        if ($item->item_type === CatalogueItemType::SubscriptionPlan) {
            return [];
        }

        if (! $item->sellsFromFinishedStock()) {
            return $this->cookedToOrderReasons($item);
        }

        return $this->finishedStockReasons($item);
    }

    /**
     * The codes alone, for a list row.
     *
     * @return list<string>
     */
    public function codes(CatalogueItem $item): array
    {
        return array_map(static fn (array $reason): string => $reason['code'], $this->reasons($item));
    }

    /**
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    private function cookedToOrderReasons(CatalogueItem $item): array
    {
        if ($item->recipe_id === null) {
            return [[
                'code' => 'stock_no_recipe',
                'detail' => 'This meal has no recipe, so a sale cannot know which ingredients to take off the shelf.',
                'context' => [],
            ]];
        }

        $version = RecipeVersion::withoutTenancy()
            ->where('recipe_id', $item->recipe_id)
            ->where('status', RecipeVersionStatus::Published->value)
            ->first(['id', 'yield_piece_count']);

        if (! $version instanceof RecipeVersion) {
            return [[
                'code' => 'stock_recipe_not_published',
                'detail' => 'This meal\'s recipe has no published version, so a sale has nothing to take its ingredients from.',
                'context' => ['recipe_id' => $item->recipe_id],
            ]];
        }

        if ($version->yield_piece_count === null || $version->yield_piece_count <= 0) {
            return [[
                'code' => 'stock_no_pieces_produced',
                'detail' => 'The published recipe does not say how many pieces one batch makes, so one portion of its ingredients cannot be worked out.',
                'context' => ['recipe_id' => $item->recipe_id, 'recipe_version_id' => (string) $version->getKey()],
            ]];
        }

        return [];
    }

    /**
     * @return list<array{code: string, detail: string, context: array<string, mixed>}>
     */
    private function finishedStockReasons(CatalogueItem $item): array
    {
        if ($item->ingredient_id === null) {
            if ($item->item_type === CatalogueItemType::Product) {
                return [];
            }

            return [[
                'code' => 'stock_no_shelf',
                'detail' => 'This item sells from finished stock but names no produced item, so there is no shelf to take a sale from.',
                'context' => [],
            ]];
        }

        if ($item->net_content_quantity !== null && $item->net_content_unit_id !== null) {
            return [];
        }

        $unit = MeasurementUnit::query()
            ->whereKey(Ingredient::withoutTenancy()->whereKey($item->ingredient_id)->value('default_unit_id'))
            ->first(['code', 'dimension']);

        // The sale's own fallback: a shelf counted in pieces takes one per sale.
        if ($unit === null || in_array($unit->dimension, ['count', 'package', 'serving'], true)) {
            return [];
        }

        if ($this->hasSizedPack($item)) {
            return [];
        }

        return [[
            'code' => 'stock_no_amount_per_sale',
            'detail' => "This item's shelf is counted in {$unit->code}, and nothing says how much one sale takes — set a pack weight or the net content.",
            'context' => ['unit_code' => $unit->code],
        ]];
    }

    /**
     * An active pack with a size: an order line snapshots it, and that size is what the
     * sale takes off the shelf.
     */
    private function hasSizedPack(CatalogueItem $item): bool
    {
        return CatalogueItemPackVariant::withoutTenancy()
            ->whereIn(
                'catalogue_item_variant_id',
                CatalogueItemVariant::withoutTenancy()
                    ->where('catalogue_item_id', $item->getKey())
                    ->where('status', VariantStatus::Active->value)
                    ->select('id'),
            )
            ->where('pack_quantity', '>', 0)
            ->exists();
    }
}
