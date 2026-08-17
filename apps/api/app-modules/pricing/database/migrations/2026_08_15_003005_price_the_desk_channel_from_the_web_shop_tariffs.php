<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The counter quotes what the web shop quotes, because it consults the same
 * tariffs in the same order.
 *
 * ## The other half of the desk
 *
 * `2026_08_15_003004_open_a_desk_channel_for_every_kitchen` gave every kitchen a
 * `desk` channel and copied its web shop's availability onto it. That makes the
 * counter *offer* things. It does not make them cost anything:
 * `PriceResolver::listsFor()` reads `channel_price_lists` as the only source of
 * a channel's tariffs, an empty set means `currentFor()` returns null, and
 * `LineProbe` turns that null into an `unpriced` refusal on every line. A desk
 * with availability and no tariffs sells nothing, silently, which is why this
 * runs and why its filename orders it after 003004 — it joins to the channel
 * that migration creates, and to nothing else.
 *
 * ## Copying verbatim is what makes the desk price identically
 *
 * `SalesChannelKind::Pos::hasPrivatePricing()` is **false**, exactly as
 * `B2cWeb`'s is. That single fact is what makes this a copy rather than a
 * translation: the resolver's one kind-dependent branch — the one that skips
 * lists whose `customer_scope` is not a public tariff, and the one that lets a
 * B2B buyer's negotiated sheet in ahead of them — behaves the same way on both
 * channels. Every list assigned to the web shop is therefore consulted on the
 * desk under the same rules, and the same article resolves to the same amount.
 *
 * So `price_list_id` and `priority` are copied unchanged. `priority` is the
 * whole of the consultation order a merchandiser stated, and the resolver stops
 * at the first list that prices the point rather than merging them, so a
 * renumbered copy would not be a cheaper desk or a dearer one — it would be a
 * desk that answers from a different tariff, which is worse than either.
 *
 * ## `created_at` is copied too, and that is deliberate
 *
 * `listsFor()` orders by `priority`, then `created_at`, then `id`. The second
 * and third keys exist so that two lists assigned at the same priority resolve
 * *consistently* rather than by whatever order PostgreSQL felt like returning —
 * the resolver's own docblock says so. That makes `created_at` an **input to
 * price resolution on this table**, not decoration, and copying it verbatim is
 * the only way the desk reproduces the web shop's order in the tie case.
 * Stamping every copy with `now()` would do the opposite: one statement gives
 * every row the same timestamp, so a tie that the web shop breaks by age would
 * fall through to a random `gen_random_uuid()` on the desk.
 *
 * One residue remains and is named here rather than hidden: where the web shop
 * itself already ties on **both** priority and `created_at` — two lists assigned
 * in the same second at the same priority — the third key decides, and the
 * desk's ids are new. The desk may then consult those two in the other order.
 * That only changes an answer if both lists price the same article on the same
 * day at different amounts, which is the configuration mistake the tie-break
 * exists to make consistent rather than correct.
 *
 * ## The same drift, one table over
 *
 * `ChannelPriceListService::replace()` deletes every assignment of a price list
 * and re-inserts the submitted channels, with no channel filter — the mirror
 * image of the availability drift 003004 records. A tariff re-stated without
 * the desk unprices the desk, and every line refuses `unpriced` at the counter.
 * Workflow mitigation, accepted with the dedicated-channel decision.
 *
 * Guarded by `UNIQUE (sales_channel_id, price_list_id)` restated as a
 * `NOT EXISTS`, so a second run adds what is missing and disturbs nothing that
 * a kitchen has since changed. `created_by` is NULL because nobody clicked
 * anything. New kitchens are `KitchenProvisioning`'s business, and have no
 * price lists to mirror on the day they are created.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            INSERT INTO channel_price_lists (
                id, organisation_id, sales_channel_id, price_list_id, priority,
                created_by, created_at, updated_at
            )
            SELECT
                gen_random_uuid(),
                src.organisation_id,
                desk.id,
                src.price_list_id,
                src.priority,
                NULL,
                src.created_at,
                src.updated_at
            FROM channel_price_lists src
            JOIN sales_channels shop
              ON shop.id = src.sales_channel_id
             AND shop.code = 'web-shop'
            JOIN sales_channels desk
              ON desk.organisation_id = shop.organisation_id
             AND desk.code = 'desk'
            WHERE NOT EXISTS (
                SELECT 1
                FROM channel_price_lists mirrored
                WHERE mirrored.sales_channel_id = desk.id
                  AND mirrored.price_list_id = src.price_list_id
            )
        SQL);
    }

    /**
     * Nothing to undo separately.
     *
     * 003004's `down()` deletes the `desk` channel and `channel_price_lists.
     * sales_channel_id` is `cascadeOnDelete`, so these rows leave with it. A
     * `DELETE` here as well would be a second writer of the same fact, and
     * migrations roll back in reverse order — this one runs *first*, against
     * rows the next one is about to remove anyway.
     *
     * Detaching a tariff is also not the sort of thing to do twice: if 003004's
     * `down()` is refused because the kitchen has sold across the counter, a
     * desk left unpriced by this one would be a channel that offers a full
     * assortment and can quote for none of it.
     */
    public function down(): void
    {
        // Intentionally empty; see the docblock.
    }
};
