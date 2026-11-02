<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Console;

use Healthy360\Inventory\Services\DuplicateStockShelves;
use Healthy360\Kitchens\Console\Concerns\RunsInsideOneKitchen;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Console\Command;

/**
 * Merge the stock shelves the automatic ingredient copies left behind.
 *
 * Read-only unless `--apply` is passed: the default prints what would be merged,
 * what stays for a person (`/kitchen/stock-duplicates`) and which empty shelves of
 * archived ingredients would go. `--apply` is what the environment allowlist
 * guards. Idempotent: a second run
 * finds nothing.
 */
final class MergeDuplicateStockCommand extends Command
{
    use RunsInsideOneKitchen;

    protected $signature = 'kitchen:merge-duplicate-stock
        {--org= : The kitchen organisation slug}
        {--apply : Write the merges. Without it nothing changes.}';

    protected $description = 'Merge duplicate stock shelves from ingredient copies (read-only without --apply).';

    public function handle(DuplicateStockShelves $duplicates): int
    {
        $apply = (bool) $this->option('apply');

        if ($apply && $this->refusesThisEnvironment('kitchen:merge-duplicate-stock')) {
            return self::FAILURE;
        }

        $kitchen = $this->resolveOrganisation();

        if (! $kitchen instanceof Organisation) {
            return self::FAILURE;
        }

        $this->insideOrganisation($kitchen, function (string $organisationId) use ($duplicates, $apply): void {
            $found = $duplicates->scan($organisationId);

            foreach ($found['merges'] as $pair) {
                $this->components->twoColumnDetail($pair['drop']->code, 'merges into '.$pair['keep']->code);

                if ($apply) {
                    $duplicates->merge($organisationId, $pair['keep'], $pair['drop']);
                }
            }

            foreach ($found['empty_archived'] as $shelf) {
                $this->components->twoColumnDetail($shelf->code, 'empty, archived ingredient: removed');

                if ($apply) {
                    $shelf->delete();
                }
            }

            foreach ($found['reviews'] as $review) {
                $this->components->twoColumnDetail($review['name'], 'for review: '.$review['reason']);
            }

            $this->components->info(sprintf(
                '%s%d merged, %d empty removed, %d for review.',
                $apply ? '' : 'Dry run: ',
                count($found['merges']),
                count($found['empty_archived']),
                count($found['reviews']),
            ));
        });

        return self::SUCCESS;
    }
}
