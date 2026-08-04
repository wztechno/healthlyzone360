<?php

declare(strict_types=1);

namespace Healthy360\Pricing\Providers;

use Healthy360\Catalogues\Contracts\ConfirmedPriceRegistry;
use Healthy360\Pricing\Contracts\BuyerAgreementLookup;
use Healthy360\Pricing\Services\NullBuyerAgreementLookup;
use Healthy360\Pricing\Services\PriceListConfirmedPriceRegistry;
use Illuminate\Support\ServiceProvider;

class PricingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bindIf(
            BuyerAgreementLookup::class,
            NullBuyerAgreementLookup::class,
        );
    }

    public function boot(): void
    {
        $this->app->bind(ConfirmedPriceRegistry::class, PriceListConfirmedPriceRegistry::class);
    }
}
