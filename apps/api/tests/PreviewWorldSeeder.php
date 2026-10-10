<?php

declare(strict_types=1);

namespace Tests;

use Database\Seeders\DatabaseSeeder;
use Database\Seeders\MarketplaceKitchensSeeder;
use Database\Seeders\MarketplacePlansSeeder;
use Illuminate\Database\Seeder;

/**
 * The full seed plus the photographed preview marketplace, which
 * `DatabaseSeeder` leaves out under PHPUnit. Run by `SeedPreviewWorldOnce`.
 */
final class PreviewWorldSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            DatabaseSeeder::class,
            MarketplaceKitchensSeeder::class,
            MarketplacePlansSeeder::class,
        ]);
    }
}
