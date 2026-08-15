<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\User;
use Healthy360\Catalogues\Models\Catalogue;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Pricing\Models\PriceList;
use Healthy360\Tenancy\Database\DatabaseTenantContext;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * The eight preview subscription plans the customer prototype always showed,
 * placed under the kitchens that sell them.
 *
 * Two of the eight belong to Verdant beside the plan `DemoTenantSeeder`
 * already seeds, and a third — `balanced-week` — *is* that seeder's published
 * marketplace plan, renamed and re-authored: the prototype and the API were
 * describing the same product under two slugs, and one of them had to go.
 * `DemoTenantSeeder` now writes it under the fixture's slug and this seeder
 * rewrites its matrix from the fixture, archiving the two configurations that
 * seeder created so the consumer surface shows the three the prototype does.
 *
 * The two kitchens the fixture gives no plan — `olive-terrace-counter` and
 * `northwind-provisions` — are not an omission: a counter and a wholesale depot
 * do not sell weekly subscriptions, and the plan endpoint answering nothing for
 * them is the fact rather than a gap.
 *
 * Runs after {@see MarketplaceKitchensSeeder}, which is what creates the
 * organisations, catalogues and public tariffs this writes onto.
 *
 * Guarded to local and testing, like every other demo seeder.
 */
class MarketplacePlansSeeder extends Seeder
{
    private const string PLAN_FIXTURE = 'seeders/fixtures/prototype_marketplace_plans.php';

    /**
     * Verdant already has an active public tariff for plans, wired to its web
     * shop by `DemoTenantSeeder`, and its prices are pinned by
     * `DatabaseSeederTest`. The preview plans join that list rather than
     * opening a rival one — two public tariffs on one channel would only raise
     * the question of which quotes.
     */
    private const string VERDANT_PLAN_TARIFF = 'verdant-marketplace-plans-usd';

    public function __construct(private readonly PlanFixtureWriter $writer) {}

    public function run(): void
    {
        if (! App::environment(['local', 'testing'])) {
            Log::warning('MarketplacePlansSeeder skipped: preview plans are seeded in local and testing environments only.');

            return;
        }

        /** @var list<array<string, mixed>> $plans */
        $plans = require database_path(self::PLAN_FIXTURE);

        foreach ($plans as $fixture) {
            $kitchenSlug = (string) $fixture['kitchen_slug'];

            $kitchen = Organisation::query()->where('slug', $kitchenSlug)->first();

            if (! $kitchen instanceof Organisation) {
                Log::warning('MarketplacePlansSeeder skipped a plan: its kitchen has not been seeded.', [
                    'plan' => $fixture['slug'],
                    'kitchen' => $kitchenSlug,
                ]);

                continue;
            }

            $catalogue = Catalogue::withoutTenancy()
                ->where('organisation_id', $kitchen->getKey())
                ->where('code', 'default')
                ->sole();

            $tariff = $this->tariffOf($kitchen);
            $owner = $this->owner($kitchen);

            // `price_list_items` carries a row-level-security policy, and the
            // readiness gate reads the rows back through it, so the whole write
            // happens inside the kitchen's own database scope — the declaration
            // `DemoTenantSeeder` makes around the same work.
            app(DatabaseTenantContext::class)->during(
                null,
                (string) $kitchen->getKey(),
                null,
                fn () => $this->writer->write($kitchen, $catalogue, $tariff, $fixture, $owner),
            );
        }
    }

    /**
     * The active public tariff a kitchen's plans are priced on.
     */
    private function tariffOf(Organisation $kitchen): PriceList
    {
        $code = $kitchen->slug === 'verdant-kitchen'
            ? self::VERDANT_PLAN_TARIFF
            : $kitchen->slug.MarketplaceKitchensSeeder::MENU_PRICE_LIST_SUFFIX;

        $tariff = PriceList::withoutTenancy()
            ->where('organisation_id', $kitchen->getKey())
            ->where('code', $code)
            ->first();

        if (! $tariff instanceof PriceList) {
            throw new RuntimeException(sprintf(
                'The preview kitchen %s has no public tariff (%s) to price its plans on.',
                $kitchen->slug,
                $code,
            ));
        }

        return $tariff;
    }

    /**
     * The kitchen's owner, who authored everything the seeders write under it.
     */
    private function owner(Organisation $kitchen): User
    {
        $email = $kitchen->slug === 'verdant-kitchen'
            ? 'owner@verdant.test'
            : 'owner@'.$kitchen->slug.'.test';

        $owner = User::query()->where('email', $email)->first();

        if (! $owner instanceof User) {
            throw new RuntimeException('The preview kitchen '.$kitchen->slug.' has no seeded owner ('.$email.').');
        }

        return $owner;
    }
}
