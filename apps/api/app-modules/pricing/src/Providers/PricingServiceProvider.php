<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Providers;

use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;
use Healthy360\Pricing\Services\PriceListConfirmedPriceRegistry;
use Illuminate\Support\ServiceProvider;

class PricingServiceProvider extends ServiceProvider
{
    public function register(): void {}

    /**
     * Answer the catalogue's publish-gate question — "which of these variants
     * has a confirmed price" — with real tariff data (K1.6).
     *
     * A plain replacement, because the catalogue binds a null object and nobody
     * else answers this question; there is nothing to compose with, unlike the
     * ingredient usage registry.
     *
     * Declared in `boot()` for the reason `CataloguesServiceProvider` gives:
     * every `register()` runs before any `boot()`, so an override declared here
     * wins whatever order package discovery puts the two modules in. Binding it
     * from `register()` would leave the winner depending on whether
     * "catalogues" or "pricing" sorts first — a guarantee nobody wrote down.
     */
    public function boot(): void
    {
        $this->app->bind(ConfirmedPriceRegistry::class, PriceListConfirmedPriceRegistry::class);
    }
}
