<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Presenters;

use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemIngredient;
use Healthy360\Catalogues\Models\CatalogueItemPackVariant;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\ChannelCatalogueItem;
use Healthy360\Catalogues\Models\SalesChannel;

/**
 * The administrative wire shapes of the catalogue.
 *
 * Both names are always carried and `Accept-Language` is ignored for them: a
 * bilingual editor has to see what it is editing (master plan v2 §4.18). An
 * empty `name_ar` is served as the empty string rather than hidden — "not yet
 * translated" is the state the publish gate refuses, and a surface that
 * concealed it would leave a kitchen wondering why publication keeps failing.
 *
 * **No money, anywhere.** There is no price, cost or margin field on any shape
 * here, because no such column exists on any table in this module. The admin
 * contract's confidential `marginPercent` is a presentation figure computed
 * from a confirmed price and a recipe cost per serving; the price arrives in
 * K1.5 and the cost is already behind `recipe.view_costs_organisation`, so a
 * margin here would be a third copy of a number this slice cannot compute
 * honestly. Recorded as a reconciliation note rather than modelled.
 *
 * There is **no public projection** in K1.4 and nothing here reaches an
 * anonymous caller. When one arrives (M1) it will be a separate presenter with
 * its own denylist sweep, never this one with fields removed — a public shape
 * derived by subtraction is one refactor away from leaking.
 */
final class CatalogueItemAdminPresenter
{
    /**
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     catalogue_id: string,
     *     item_type: string,
     *     slug: string,
     *     name_en: string,
     *     name_ar: string,
     *     description_en: string|null,
     *     description_ar: string|null,
     *     product_category_id: string|null,
     *     production_mode: string|null,
     *     recipe_id: string|null,
     *     ingredient_id: string|null,
     *     purchasing_unit_id: string|null,
     *     usage_unit_id: string|null,
     *     is_market_priced: bool,
     *     is_assorted: bool,
     *     status: string,
     *     review_reason: string|null,
     *     image_placeholder_id: string|null,
     *     data_quality_flags: list<string>,
     *     source_system: string|null,
     *     source_ref: string|null,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function item(CatalogueItem $item): array
    {
        $flags = $item->data_quality_flags ?? [];

        return [
            'id' => (string) $item->getKey(),
            'organisation_id' => $item->organisation_id,
            'catalogue_id' => $item->catalogue_id,
            'item_type' => $item->item_type->value,
            'slug' => $item->slug,
            'name_en' => $item->name_en,
            'name_ar' => $item->name_ar,
            'description_en' => $item->description_en,
            'description_ar' => $item->description_ar,
            'product_category_id' => $item->product_category_id,
            'production_mode' => $item->production_mode?->value,
            'recipe_id' => $item->recipe_id,
            'ingredient_id' => $item->ingredient_id,
            'purchasing_unit_id' => $item->purchasing_unit_id,
            'usage_unit_id' => $item->usage_unit_id,
            'is_market_priced' => $item->is_market_priced,
            'is_assorted' => $item->is_assorted,
            'status' => $item->status->value,
            'review_reason' => $item->review_reason,
            'image_placeholder_id' => $item->image_placeholder_id,
            'data_quality_flags' => $flags,
            'source_system' => $item->source_system,
            'source_ref' => $item->source_ref,
            'lock_version' => $item->lock_version,
            'created_at' => $item->created_at?->toIso8601String(),
            'updated_at' => $item->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     variant_type: string,
     *     code: string,
     *     name_en: string|null,
     *     name_ar: string|null,
     *     is_default: bool,
     *     status: string,
     *     pack: array{pack_quantity: string, pack_unit_id: string, pack_piece_count: int|null, pack_format: string|null, net_weight_grams: int|null}|null,
     *     lock_version: int
     * }
     */
    public function variant(CatalogueItemVariant $variant, ?CatalogueItemPackVariant $pack = null): array
    {
        return [
            'id' => (string) $variant->getKey(),
            'variant_type' => $variant->variant_type->value,
            'code' => $variant->code,
            'name_en' => $variant->name_en,
            'name_ar' => $variant->name_ar,
            'is_default' => $variant->is_default,
            'status' => $variant->status->value,
            'pack' => $pack === null ? null : [
                'pack_quantity' => (string) $pack->pack_quantity,
                'pack_unit_id' => $pack->pack_unit_id,
                'pack_piece_count' => $pack->pack_piece_count,
                'pack_format' => $pack->pack_format?->value,
                'net_weight_grams' => $pack->net_weight_grams,
            ],
            'lock_version' => $variant->lock_version,
        ];
    }

    /**
     * @return array{id: string, ingredient_id: string, is_representative: bool, display_order: int}
     */
    public function ingredient(CatalogueItemIngredient $row): array
    {
        return [
            'id' => (string) $row->getKey(),
            'ingredient_id' => $row->ingredient_id,
            'is_representative' => $row->is_representative,
            'display_order' => $row->display_order,
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     sales_channel_id: string,
     *     catalogue_item_variant_id: string|null,
     *     is_available: bool,
     *     available_from: string|null,
     *     available_to: string|null
     * }
     */
    public function channelAssignment(ChannelCatalogueItem $row): array
    {
        return [
            'id' => (string) $row->getKey(),
            'sales_channel_id' => $row->sales_channel_id,
            'catalogue_item_variant_id' => $row->catalogue_item_variant_id,
            'is_available' => $row->is_available,
            'available_from' => $row->available_from?->toDateString(),
            'available_to' => $row->available_to?->toDateString(),
        ];
    }

    /**
     * @return array{
     *     id: string,
     *     organisation_id: string,
     *     code: string,
     *     channel_kind: string,
     *     name_en: string,
     *     name_ar: string,
     *     order_source: string|null,
     *     status: string,
     *     lock_version: int,
     *     created_at: string|null,
     *     updated_at: string|null
     * }
     */
    public function salesChannel(SalesChannel $channel): array
    {
        return [
            'id' => (string) $channel->getKey(),
            'organisation_id' => $channel->organisation_id,
            'code' => $channel->code,
            'channel_kind' => $channel->channel_kind->value,
            'name_en' => $channel->name_en,
            'name_ar' => $channel->name_ar,
            'order_source' => $channel->order_source,
            'status' => $channel->status->value,
            'lock_version' => $channel->lock_version,
            'created_at' => $channel->created_at?->toIso8601String(),
            'updated_at' => $channel->updated_at?->toIso8601String(),
        ];
    }
}
