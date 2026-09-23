<?php

declare(strict_types=1);

namespace Tests;

/**
 * `SeedDatabaseOnce`, with the photographed preview marketplace seeded too.
 *
 * `DatabaseSeeder` keeps the preview world out of PHPUnit, so the few files
 * that read it seed it themselves. `$seeder` takes precedence over `$seed` in
 * `RefreshDatabase`'s `migrate:fresh`, so both halves are written once per file.
 */
trait SeedPreviewWorldOnce
{
    use SeedDatabaseOnce;

    protected string $seeder = PreviewWorldSeeder::class;
}
