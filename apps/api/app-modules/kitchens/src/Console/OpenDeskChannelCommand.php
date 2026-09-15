<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Kitchens\Import\Runtime\KitchenWorkbookWorld;
use Healthy360\Orders\OrderDesk\Services\DeskChannelLocator;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Open the counter's sales channel for one kitchen, and give it whatever the
 * web shop already sells.
 *
 * ## Why a command and not a migration
 *
 * The desk channel arrives three ways and each of them has a hole this command
 * fills. `KitchenProvisioning` opens one for every kitchen it creates — but the
 * workbook and v6 importers create their kitchen themselves
 * ({@see KitchenWorkbookWorld}) and open
 * `web-shop` and `wholesale` only. The `2026_08_15_003004` /
 * `2026_08_15_003005` pair backfilled every kitchen that existed on the day —
 * but a migration runs once, and an imported kitchen is created long after it.
 * A kitchen in that state reaches the counter and is refused by
 * {@see DeskChannelLocator} with a 409
 * naming this exact repair.
 *
 * ## It is also the drift repair
 *
 * Both mirrors drift *away* by design: `CatalogueItemChannelReplaceController`
 * restates an item's channels and `ChannelPriceListService::replace()` restates
 * a tariff's, each with no channel filter, so anything submitted without the
 * desk silently unsells or unprices it. That was accepted with the
 * dedicated-channel decision on the understanding that the mirror could be
 * re-run, and this is the thing that re-runs it. Additive and guarded by the
 * same `NOT EXISTS` clauses the migrations used: a second run adds what is
 * missing and disturbs nothing a kitchen has since changed by hand.
 *
 * ## Not environment-allowlisted
 *
 * Unlike the importers beside it this writes no catalogue content, no prices
 * and no food-safety determination — it copies one kitchen's own assortment
 * onto one more of its own channels, which is what `KitchenProvisioning` does
 * unguarded in production for every new kitchen. A counter that cannot sell is
 * a production fault, and the repair has to be runnable where the fault is.
 */
final class OpenDeskChannelCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:open-desk-channel
        {--org=healthzone360-kitchen : The kitchen organisation to open the counter for}';

    protected $description = "Open a kitchen's `desk` sales channel and mirror the web shop's articles and tariffs onto it.";

    /**
     * The counter's channel code — the same literal `DeskChannelLocator` and
     * `KitchenProvisioning` hold, for the reasons their docblocks give.
     */
    private const string DESK_CHANNEL_CODE = 'desk';

    private const string SHOP_CHANNEL_CODE = 'web-shop';

    /**
     * The channel itself, named after the web shop it mirrors exactly as the
     * backfill migration named it: `Verdant Kitchen web shop` becomes
     * `Verdant Kitchen order desk`, and a bare `Web shop` becomes a bare
     * `Order desk`.
     *
     * `gen_random_uuid()` rather than the application's ordered UUIDv7, again
     * following 003004: it is core PostgreSQL, and none of these rows is ever
     * read in id order.
     */
    private const string CHANNEL_SQL = <<<'SQL'
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
        WHERE shop.organisation_id = :organisation_id
          AND shop.code = 'web-shop'
          AND NOT EXISTS (
              SELECT 1
              FROM sales_channels existing
              WHERE existing.organisation_id = shop.organisation_id
                AND existing.code = 'desk'
          )
        SQL;

    /** What the counter may sell: every article the web shop offers. */
    private const string ARTICLES_SQL = <<<'SQL'
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
         AND shop.organisation_id = :organisation_id
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
        SQL;

    /** What the counter may charge: every tariff the web shop quotes from. */
    private const string TARIFFS_SQL = <<<'SQL'
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
         AND shop.organisation_id = :organisation_id
        JOIN sales_channels desk
          ON desk.organisation_id = shop.organisation_id
         AND desk.code = 'desk'
        WHERE NOT EXISTS (
            SELECT 1
            FROM channel_price_lists mirrored
            WHERE mirrored.sales_channel_id = desk.id
              AND mirrored.price_list_id = src.price_list_id
        )
        SQL;

    public function handle(): int
    {
        $organisation = $this->resolveOrganisation();

        if (! $organisation instanceof Organisation) {
            return self::FAILURE;
        }

        $this->components->info(sprintf('Open the order desk — organisation: %s', $organisation->slug));

        /** @var int $exit */
        $exit = $this->insideOrganisation($organisation, function (string $organisationId): int {
            $opened = DB::affectingStatement(self::CHANNEL_SQL, ['organisation_id' => $organisationId]);

            $desk = DB::table('sales_channels')
                ->where('organisation_id', $organisationId)
                ->where('code', self::DESK_CHANNEL_CODE)
                ->first(['id', 'status']);

            if ($desk === null) {
                $this->components->error(sprintf(
                    'This kitchen has no "%s" channel, so there is nothing to mirror onto the counter.',
                    self::SHOP_CHANNEL_CODE,
                ));
                $this->line('  The desk sells what the web shop sells; open the web shop first (kitchen:import-v6 --publish does).');

                return self::FAILURE;
            }

            $deskId = (string) $desk->id;

            $articles = DB::affectingStatement(self::ARTICLES_SQL, ['organisation_id' => $organisationId]);
            $tariffs = DB::affectingStatement(self::TARIFFS_SQL, ['organisation_id' => $organisationId]);

            $this->line(sprintf('  · channel: %s', $opened === 1 ? 'opened' : 'already open'));
            $this->line(sprintf(
                '  · articles: %d mirrored, %d on the counter',
                $articles,
                DB::table('channel_catalogue_items')->where('sales_channel_id', $deskId)->count(),
            ));
            $this->line(sprintf(
                '  · tariffs: %d mirrored, %d quoted from',
                $tariffs,
                DB::table('channel_price_lists')->where('sales_channel_id', $deskId)->count(),
            ));

            // An unpriced channel refuses every line, and the refusal the agent
            // sees is per-line and about the food rather than about the
            // counter — so say it here, where the operator can act on it.
            if (DB::table('channel_price_lists')->where('sales_channel_id', $deskId)->doesntExist()) {
                $this->components->warn('The counter has no tariff, so every line will refuse as unpriced.');
                $this->line('  The web shop has none either — run kitchen:activate-imported-tariffs, then this command again.');
            }

            if ((string) $desk->status !== 'active') {
                $this->components->warn(sprintf(
                    'The desk channel is "%s" rather than active; reactivate it before selling across the counter.',
                    (string) $desk->status,
                ));
            }

            return self::SUCCESS;
        });

        return $exit;
    }
}
