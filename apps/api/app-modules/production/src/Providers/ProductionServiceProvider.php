<?php

declare(strict_types=1);

namespace Healthy360\Production\Providers;

use Healthy360\Inventory\Contracts\ProductionValuationLedger;
use Healthy360\Production\Services\ProductionValuationLedgerReader;
use Illuminate\Support\ServiceProvider;

/**
 * Production's one binding (PROD1).
 *
 * Inventory declares {@see ProductionValuationLedger} with a null default, and
 * this replaces it. Registered from the **downstream** module, the house
 * inverted-port pattern: the monthly cost report — in Procurement — learns that
 * somebody can tell it about unvalued batches without learning that Production
 * exists, which is what keeps the graph acyclic against the
 * `Production → Procurement` edge the finished-goods blend needs.
 *
 * In `boot()` rather than `register()` for the reason `InventoryServiceProvider`
 * gives: every `register()` runs before any `boot()`, so an override declared
 * here wins whatever order package discovery happens to put the two modules in.
 */
class ProductionServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        $this->app->bind(ProductionValuationLedger::class, ProductionValuationLedgerReader::class);
    }
}
