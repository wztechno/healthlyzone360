<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Import\Runtime;

/**
 * One run's instructions, resolved from the command line once so that nothing
 * downstream has to ask the console what it was told.
 *
 * The two "do less" flags are deliberately separate rather than one verbosity
 * level, because they answer different questions. `--validate-only` asks *does
 * this workbook parse and what is wrong with it* and never looks at the
 * database at all; `--dry-run` asks *what would this run change* and therefore
 * has to read the database to know what already exists. A single flag would
 * have made the cheaper question require a working database connection.
 */
final readonly class ImportOptions
{
    public function __construct(
        public string $sourceDirectory,
        public string $organisationSlug,
        public bool $dryRun = false,
        public bool $validateOnly = false,
    ) {}

    /**
     * Whether this run may write. `--validate-only` implies `--dry-run`: a run
     * that never reads the database certainly must not write to it.
     */
    public function writes(): bool
    {
        return ! $this->dryRun && ! $this->validateOnly;
    }

    public function mode(): string
    {
        return match (true) {
            $this->validateOnly => 'validate-only',
            $this->dryRun => 'dry-run',
            default => 'live',
        };
    }
}
