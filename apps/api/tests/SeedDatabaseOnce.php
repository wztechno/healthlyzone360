<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Testing\RefreshDatabaseState;
use PHPUnit\Framework\Attributes\AfterClass;
use PHPUnit\Framework\Attributes\BeforeClass;

/**
 * Seed the full database once per file, rather than once per case.
 *
 * `RefreshDatabase` migrates once per process and rolls every case back, so a
 * `beforeEach(fn () => $this->seed())` is undone after each case and paid for
 * again by the next one. This trait moves the seeding into the migration:
 *
 * - before the file, it clears the "already migrated" flag, so the file's first
 *   case runs `migrate:fresh --seed` and commits the seeded world outside any
 *   case's transaction (`$seed` is what makes `RefreshDatabase` add `--seed`);
 * - every case still runs in its own rolled-back transaction, so a case that
 *   edits or re-seeds hands the next case the same world;
 * - after the file, it clears the flag again, so the next file's first case
 *   migrates afresh and never sees these rows.
 *
 * The cost is one extra `migrate:fresh` for whichever file runs next.
 */
trait SeedDatabaseOnce
{
    protected bool $seed = true;

    #[BeforeClass]
    public static function migrateAndSeedBeforeTheFile(): void
    {
        RefreshDatabaseState::$migrated = false;
    }

    #[AfterClass]
    public static function migrateAfreshAfterTheFile(): void
    {
        RefreshDatabaseState::$migrated = false;
    }
}
