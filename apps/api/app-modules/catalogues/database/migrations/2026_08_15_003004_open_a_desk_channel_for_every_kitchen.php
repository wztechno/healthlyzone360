<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Every kitchen that can take a web order gets a counter it can sell across —
 * and it opens holding exactly what the web shop holds.
 *
 * ## The decision this implements
 *
 * The Order Desk could have sold through the `web-shop` channel every kitchen
 * already has, tagging provenance onto the order instead. The owner chose a
 * **dedicated `desk` channel** (2026-08-15), and the reason is curation: a
 * counter assortment is not a web assortment. A kitchen that wants to sell the
 * catering trays across the counter and not on the site, or to stop offering
 * the delicate thing to walk-ins at four o'clock, can only say so if the desk
 * is a channel of its own. The cost of that choice is stated below and was
 * accepted with it.
 *
 * ## Why a channel row is not enough, and this migration is two writes
 *
 * A `sales_channels` row on its own sells nothing at all, silently. Two
 * separate mechanisms refuse every line:
 *
 *  * `LineProbe::probe()` refuses an article with no `channel_catalogue_items`
 *    row for the channel — `channel_unavailable`. The absence of an assignment
 *    says nothing at all (that is the table's whole design), so a new channel
 *    offers nothing rather than everything.
 *  * `PriceResolver::listsFor()` reads `channel_price_lists` as the **only**
 *    source of a channel's tariffs. An empty set makes `currentFor()` return
 *    null and every line refuses `unpriced`.
 *
 * So the availability half is duplicated here and the tariff half in
 * `2026_08_15_003005_price_the_desk_channel_from_the_web_shop_tariffs`, whose
 * filename orders it after this one because it joins to the channel this
 * creates. A desk with one half and not the other is a desk that refuses
 * everything — and refuses it per line, at the counter, in front of a customer.
 *
 * ## The desk is born as an exact mirror of the web shop
 *
 * Every assignment is copied verbatim: the article, the variant when one is
 * named, `is_available`, and both ends of the availability window. Not
 * "everything published" and not "everything, always" — the copy is of the
 * kitchen's own decisions, so a meal switched off on the web shop is switched
 * off at the counter on day one, and a seasonal window that opens in March
 * opens in March at both. A kitchen that then wants the two to differ diverges
 * them deliberately from a starting point it recognises, which is the only
 * honest place to start it from.
 *
 * ## The drift, stated plainly, because it is not fixed here
 *
 * `ChannelAvailabilityService::replace()` — the service behind
 * `PUT /catalogue/items/{item}/channels` — deletes **all** of an item's
 * assignments and re-inserts the submitted set:
 *
 *     ChannelCatalogueItem::withoutTenancy()->where('catalogue_item_id', …)->delete();
 *
 * There is no channel filter on that delete, and there cannot be one without
 * changing what the endpoint means: availability is replaced as a *set*,
 * deliberately. The consequence is that **any** channels PUT that omits the
 * desk silently makes that item unsellable at the counter, and the kitchen
 * workbook importer publishes to `web-shop` only, so an imported product
 * arrives web-only from the start. `ChannelPriceListService::replace()` has the
 * same shape one table over — it deletes every assignment of a *price list* and
 * re-inserts the submitted channels — so a tariff re-stated without the desk
 * unprices the desk the same way.
 *
 * That is a **workflow mitigation, not a structural one**: the fix is that
 * whoever assigns an item to channels names both, and the risk was accepted
 * with the dedicated-channel decision. It is written here rather than in a
 * release note because this is the file a reader lands on when they ask why the
 * counter stopped offering something.
 *
 * ## Backfill, therefore idempotent, therefore guarded rather than upserted
 *
 * Both statements are `INSERT … SELECT … WHERE NOT EXISTS` rather than
 * `ON CONFLICT DO UPDATE`. A re-run must add what is missing and touch nothing
 * else: a kitchen that has already curated its counter differently from its web
 * shop must not have that curation quietly restored to the mirror. The
 * assignment guard compares the variant with `IS NOT DISTINCT FROM` because the
 * table's key is `UNIQUE NULLS NOT DISTINCT (sales_channel_id,
 * catalogue_item_id, catalogue_item_variant_id)` — under plain `=` a NULL
 * variant never matches itself and the guard would let every item-level row
 * through a second time, straight into the constraint.
 *
 * `sales_channels` carries `UNIQUE (organisation_id, code)`, so the channel
 * guard is also the constraint's own rule restated; it is written out anyway
 * rather than relied upon, because a guard that refuses to insert is a
 * migration that finishes and a constraint that refuses is a deployment that
 * stops.
 *
 * ## `created_by` is NULL, and the name comes off the web shop
 *
 * Nobody clicked anything. `created_by` is nullable precisely so that a row the
 * platform wrote on a kitchen's behalf does not have to name a person who did
 * not write it. The English and Arabic names are derived from the web shop's,
 * with its own storefront descriptor stripped, so `Verdant Kitchen web shop`
 * becomes `Verdant Kitchen order desk` and a bare `Web shop` becomes a bare
 * `Order desk` — a kitchen that names its channels after itself keeps doing so.
 *
 * New kitchens are **not** this migration's business: `KitchenProvisioning`
 * opens the desk as its fifth write, and a kitchen created a minute ago has no
 * items and no price lists to mirror.
 */
return new class extends Migration
{
    public function up(): void
    {
        // `gen_random_uuid()` rather than the application's ordered UUIDv7: it
        // is in core PostgreSQL from 13 and needs no extension, and neither
        // table this migration writes is ever read in id order. (The one place
        // an id *is* — the price-resolution tie-break on `channel_price_lists`
        // — belongs to 003005, which says what it does about it.)
        DB::statement(<<<'SQL'
            INSERT INTO sales_channels (
                id, organisation_id, code, channel_kind, name_en, name_ar,
                order_source, status, created_by, updated_by, lock_version,
                created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                shop.organisation_id,
                'desk',
                'pos',
                COALESCE(
                    NULLIF(btrim(regexp_replace(shop.name_en, '[[:space:]]*web[[:space:]]*shop[[:space:]]*$', '', 'i')), '') || ' order desk',
                    'Order desk'
                ),
                COALESCE(
                    'مكتب طلبات ' || NULLIF(btrim(regexp_replace(shop.name_ar, '[[:space:]]*المتجر[[:space:]]+الإلكتروني[[:space:]]*$', '')), ''),
                    'مكتب الطلبات'
                ),
                'desk',
                'active',
                NULL,
                NULL,
                0,
                now() AT TIME ZONE 'UTC',
                now() AT TIME ZONE 'UTC'
            FROM sales_channels shop
            WHERE shop.code = 'web-shop'
              AND NOT EXISTS (
                  SELECT 1
                  FROM sales_channels existing
                  WHERE existing.organisation_id = shop.organisation_id
                    AND existing.code = 'desk'
              )
        SQL);

        // The mirror. `organisation_id` is copied from the source row rather
        // than re-derived: the column is a denormalisation of the same fact the
        // channel and the item both carry, and copying it is the only way the
        // copy cannot disagree with what it copied.
        DB::statement(<<<'SQL'
            INSERT INTO channel_catalogue_items (
                id, organisation_id, sales_channel_id, catalogue_item_id,
                catalogue_item_variant_id, is_available, available_from,
                available_to, created_by, created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                src.organisation_id,
                desk.id,
                src.catalogue_item_id,
                src.catalogue_item_variant_id,
                src.is_available,
                src.available_from,
                src.available_to,
                NULL,
                now() AT TIME ZONE 'UTC',
                now() AT TIME ZONE 'UTC'
            FROM channel_catalogue_items src
            JOIN sales_channels shop
              ON shop.id = src.sales_channel_id
             AND shop.code = 'web-shop'
            JOIN sales_channels desk
              ON desk.organisation_id = shop.organisation_id
             AND desk.code = 'desk'
            WHERE NOT EXISTS (
                SELECT 1
                FROM channel_catalogue_items mirrored
                WHERE mirrored.sales_channel_id = desk.id
                  AND mirrored.catalogue_item_id = src.catalogue_item_id
                  AND mirrored.catalogue_item_variant_id IS NOT DISTINCT FROM src.catalogue_item_variant_id
            )
        SQL);
    }

    /**
     * The mirror goes, the channel goes, and the cascade takes the rest.
     *
     * Deleting the `desk` channel takes its `channel_catalogue_items` and
     * `channel_price_lists` rows with it — both are `cascadeOnDelete` on the
     * channel — so the assignments do not need deleting first and deleting them
     * separately would only invite the two halves to disagree.
     *
     * What this does **not** do is worry about orders placed through the desk:
     * `orders.sales_channel_id` and `subscriptions.sales_channel_id` are both
     * `restrictOnDelete`, so a kitchen that has sold across the counter refuses
     * this `down()` at the database. That refusal is correct. An order
     * remembers which channel sold it, and a rollback that could erase that
     * memory would be a rollback that rewrites history rather than undoing a
     * schema change.
     */
    public function down(): void
    {
        DB::statement("DELETE FROM sales_channels WHERE code = 'desk'");
    }
};
