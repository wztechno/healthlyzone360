<?php

declare(strict_types=1);

namespace Healthy360\Payments\Providers;

use Healthy360\B2b\Contracts\InvoicingSettlementLookup;
use Healthy360\Payments\Services\PaymentsInvoicingSettlementLookup;
use Illuminate\Support\ServiceProvider;

class PaymentsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(InvoicingSettlementLookup::class, PaymentsInvoicingSettlementLookup::class);
    }

    public function boot(): void {}
}
