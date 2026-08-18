<?php

declare(strict_types=1);

namespace Healthy360\Inventory\Console;

use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Str;

/**
 * Bring every kitchen's stock items in line with its ingredients and its resold
 * products (INV2.0).
 *
 * The backfill half of {@see StockItemDerivationService}: derivation keeps itself
 * true as ingredients and products are created, but the rows that already exist
 * need one pass to catch up, and a re-seeded database needs one to start.
 * Idempotent, so running it on a healthy database prints zeroes and changes
 * nothing.
 *
 * Kitchens only. A clinic or a corporate customer has a catalogue in the same
 * tables and no shelves at all; deriving stock for one would invent a warehouse
 * nobody asked for.
 */
final class DeriveStockItemsCommand extends Command
{
    protected $signature = 'inventory:derive-stock-items
        {--org= : One organisation id or slug (defaults to every kitchen)}';

    protected $description = "Derive stock items from each kitchen's ingredients and bought-in products";

    public function handle(StockItemDerivationService $derivation): int
    {
        $organisations = $this->targets();

        if ($organisations === []) {
            $this->components->error('No kitchen organisation matched.');

            return self::FAILURE;
        }

        $totals = ['ingredients' => 0, 'products' => 0, 'adopted' => 0];

        foreach ($organisations as $organisation) {
            $counts = $derivation->syncOrganisation((string) $organisation->getKey());

            foreach ($totals as $key => $running) {
                $totals[$key] = $running + $counts[$key];
            }

            $this->components->twoColumnDetail(
                $organisation->slug,
                sprintf('%d ingredient, %d product, %d adopted', $counts['ingredients'], $counts['products'], $counts['adopted']),
            );
        }

        $this->components->info(sprintf(
            '%d kitchen(s): %d ingredient-backed, %d product-backed, %d adopted.',
            count($organisations),
            $totals['ingredients'],
            $totals['products'],
            $totals['adopted'],
        ));

        return self::SUCCESS;
    }

    /**
     * @return list<Organisation>
     */
    private function targets(): array
    {
        $query = Organisation::query()->whereHas('type', static function ($type): void {
            $type->where('code', 'kitchen');
        });

        $selector = $this->option('org');

        if (is_string($selector) && $selector !== '') {
            // The id comparison is guarded rather than unconditional: `id` is a uuid column, and
            // Postgres rejects the whole query with `invalid input syntax for type uuid` the moment
            // a slug is compared to it — so an `orWhere('id', $slug)` breaks the slug lookup it was
            // meant to complement rather than merely failing to match.
            $isUuid = Str::isUuid($selector);

            $query->where(static function (Builder $scoped) use ($selector, $isUuid): void {
                $scoped->where('slug', $selector);

                if ($isUuid) {
                    $scoped->orWhere('id', $selector);
                }
            });
        }

        return array_values($query->orderBy('slug')->get()->all());
    }
}
