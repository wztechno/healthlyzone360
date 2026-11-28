<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Kitchens\Services\DuplicatePacks;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Console\Command;

/**
 * Merge the `b2b` / `b2c` pack pairs the v6 importer made where the two are the
 * same pack: one pack, carrying both its Home shop and its Business price.
 *
 * {@see DuplicatePacks} decides which pairs are the same thing and does the
 * merge. Everything it will not merge is reported with the reason and left
 * alone. `--dry-run` runs each merge, price check included, inside a transaction
 * that is rolled back, so the report is what a live run would do and nothing is
 * written. A live run is what the environment allowlist guards. Idempotent: a
 * merged item has one pack left, so a second run finds nothing to merge.
 */
final class MergeDuplicatePacksCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:merge-duplicate-packs
        {--org= : The kitchen organisation slug (defaults to the configured one)}
        {--dry-run : Report what would be merged and skipped, and write nothing}';

    protected $description = 'Merge the identical b2b/b2c pack pairs into one pack carrying both prices.';

    public function handle(DuplicatePacks $duplicates): int
    {
        $dryRun = (bool) $this->option('dry-run');

        if (! $dryRun && $this->refusesThisEnvironment('kitchen:merge-duplicate-packs')) {
            return self::FAILURE;
        }

        $kitchen = $this->resolveOrganisation();

        if (! $kitchen instanceof Organisation) {
            return self::FAILURE;
        }

        $this->components->info(sprintf(
            'Merge duplicate packs — mode: %s · organisation: %s',
            $dryRun ? 'dry-run' : 'live',
            $kitchen->slug,
        ));

        $this->insideOrganisation($kitchen, function (string $organisationId) use ($duplicates, $dryRun): void {
            $merged = 0;
            $skipped = 0;

            foreach ($duplicates->scan($organisationId) as $pair) {
                $title = sprintf('%s (%s + %s)', $pair['item']->name_en, $pair['keep']->code, $pair['drop']->code);
                $reason = $pair['reason'] ?? $duplicates->merge($organisationId, $pair, $dryRun);

                // The detail goes on a plain line of its own, so a long reason is never wrapped or cut.
                if ($reason !== null) {
                    $this->components->twoColumnDetail($title, 'skipped');
                    $this->line('    '.$reason);
                    $skipped++;

                    continue;
                }

                $moves = $pair['moves'] === []
                    ? 'no prices to move'
                    : implode(', ', array_map(
                        static fn (array $move): string => sprintf('%s %d', $move['list'], $move['amount_minor']),
                        $pair['moves'],
                    ));

                $this->components->twoColumnDetail($title, $dryRun ? 'would merge' : 'merged');
                $this->line(sprintf(
                    $dryRun ? '    would keep %s, would archive %s; would move %s' : '    kept %s, archived %s; moved %s',
                    $pair['keep']->code,
                    $pair['drop']->code,
                    $moves,
                ));
                $merged++;
            }

            $this->components->info(sprintf(
                '%s%d merged, %d skipped.',
                $dryRun ? 'Dry run: ' : '',
                $merged,
                $skipped,
            ));
        });

        return self::SUCCESS;
    }
}
