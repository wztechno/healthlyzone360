<?php

declare(strict_types=1);

namespace Database\Seeders;

use Healthy360\Inventory\Services\StockItemDerivationService;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Seeder;

/**
 * Derive every kitchen's stock items from its ingredients and its bought-in
 * products (INV2.0).
 *
 * Runs last, and it has to: derivation reads the ingredient library, the demo
 * tenants' catalogues and whatever stock items the ops demo already wrote, so
 * every one of those has to exist before it can produce the right answer.
 *
 * Idempotent — it converges rather than accumulating — so re-seeding a database
 * that already has derived stock changes nothing.
 */
class DerivedStockSeeder extends Seeder
{
    public function run(StockItemDerivationService $derivation): void
    {
        $kitchens = Organisation::query()
            ->whereHas('type', static function ($type): void {
                $type->where('code', 'kitchen');
            })
            ->orderBy('slug')
            ->get();

        foreach ($kitchens as $kitchen) {
            $derivation->syncOrganisation((string) $kitchen->getKey());
        }
    }
}
