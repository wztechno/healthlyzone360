<?php

declare(strict_types=1);

namespace Database\Seeders;

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Consent\Database\Seeders\ConsentDefinitionSeeder;
use Healthy360\Features\Database\Seeders\FeatureDefinitionSeeder;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\Seeder;

/**
 * Orchestrates the module seeders. Every seeder is idempotent, so running
 * this against an already-seeded database converges rather than duplicating.
 *
 * Model events must stay enabled (no WithoutModelEvents): UUIDv7 primary keys
 * are generated in a `creating` hook, and organisation-scoped models fill
 * their scoping column in one too.
 *
 * Order matters — reference data underpins organisations, and the permission
 * catalogue underpins the template roles that DemoTenantSeeder assigns. The
 * kitchen reference data (allergen classes, platform ingredient library) sits
 * with the rest of the reference layer, because it depends on measurement
 * units and on nothing tenant-shaped.
 *
 * The preview marketplace (five more kitchens and the eight plans the customer
 * app was designed against) sits immediately after the demonstration tenants,
 * because it relocates meals that seeder writes and prices plans onto tariffs
 * it created — and is skipped under PHPUnit; see {@see self::previewWorld()}.
 */
class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            ReferenceDataSeeder::class,
            KitchenReferenceSeeder::class,
            OrganisationTypeSeeder::class,
            AccessControlSeeder::class,
            FeatureDefinitionSeeder::class,
            ConsentDefinitionSeeder::class,
            DemoTenantSeeder::class,
            ...$this->previewWorld(),
            // After the tenants, and necessarily so: the demo customer's
            // address has to sit in an area a demo kitchen already claims, or
            // the activation evaluator would refuse it — which is exactly the
            // behaviour the persona exists to demonstrate.
            DemoCustomerSeeder::class,
            // After the tenants too: synthetic stock needs the demonstration
            // kitchen and its branch to already exist.
            OpsDemoSeeder::class,
            // After Verdant's wholesale channel and published meals exist.
            B2bProgrammesDemoSeeder::class,
        ]);
    }

    /**
     * The five preview marketplace kitchens and the eight preview plans —
     * seeded everywhere except under PHPUnit.
     *
     * The photographed preview world is opt-in under PHPUnit: ~115 test cases
     * seed this graph, only the preview test asserts against it, and five more
     * organisations carrying twenty-six meals and eight subscription plans is a
     * cost every one of them would pay for nothing. The gate lives here rather
     * than inside the seeders so that `$this->seed(MarketplaceKitchensSeeder::class)`
     * still works from the test that does want them.
     *
     * `runningUnitTests()`, not `APP_ENV=testing` — the precedent
     * `VerdantProductCatalogueSeeder` sets: a polluted shell environment must
     * not silently empty a demo marketplace.
     *
     * @return list<class-string>
     */
    private function previewWorld(): array
    {
        if (app()->runningUnitTests()) {
            return [];
        }

        return [MarketplaceKitchensSeeder::class, MarketplacePlansSeeder::class];
    }
}
