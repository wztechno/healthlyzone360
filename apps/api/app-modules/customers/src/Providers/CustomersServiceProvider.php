<?php

declare(strict_types=1);

namespace Healthy360\Customers\Providers;

use Healthy360\Customers\Closure\Blockers\ActiveOrganisationMembershipsBlocker;
use Healthy360\Customers\Closure\Blockers\ActiveSubscriptionsBlocker;
use Healthy360\Customers\Closure\Blockers\CreditMemoBlocker;
use Healthy360\Customers\Closure\Blockers\OpenOrdersBlocker;
use Healthy360\Customers\Closure\Blockers\PaymentMethodsBlocker;
use Healthy360\Customers\Closure\Blockers\PendingB2bSignatoryBlocker;
use Healthy360\Customers\Closure\Blockers\WalletBalanceBlocker;
use Healthy360\Customers\Closure\Contracts\B2bSignatoryPresence;
use Healthy360\Customers\Closure\Contracts\CustomerCreditPresence;
use Healthy360\Customers\Closure\Contracts\OrderAnonymisation;
use Healthy360\Customers\Closure\Contracts\SubscriptionPresence;
use Healthy360\Customers\Closure\Services\ClosureBlockerRegistry;
use Healthy360\Customers\Closure\Services\NullB2bSignatoryPresence;
use Healthy360\Customers\Closure\Services\NullCustomerCreditPresence;
use Healthy360\Customers\Closure\Services\NullSubscriptionPresence;
use Healthy360\Customers\Closure\Services\OrderSnapshotAnonymiser;
use Healthy360\Customers\Contracts\AreaServiceLookup;
use Healthy360\Customers\Services\DeliveryZoneAreaService;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Support\ServiceProvider;

class CustomersServiceProvider extends ServiceProvider
{
    /**
     * The ports this module declares, and the closure registry built over them.
     *
     * `AreaServiceLookup` is bound here rather than in the delivery module,
     * because the dependency runs Customers → Delivery. The port is declared by
     * the consumer (this module states what it needs) and satisfied by an
     * adapter that knows both sides; delivery keeps knowing nothing about
     * customers, which is what keeps the graph acyclic.
     *
     * **`bind` for that one, `bindIf` for the three closure ports.**
     * `AreaServiceLookup` has exactly one implementation and always will. The
     * closure ports are the opposite case: each is a question about a neighbour
     * that may or may not exist in a given deployment, and each has a default
     * here whose only job is to be honest about not knowing. `bindIf` means the
     * module that *does* know — subscriptions, b2b, orders — wins by
     * registering later, without either side checking for the other and without
     * an integrator having to remember to unbind anything.
     *
     * **Every one of the four is now superseded in this deployment**, and the
     * defaults stay exactly where they are. That is what `bindIf` is for: the
     * null answers remain correct for a tree built without the neighbour, and
     * are simply never resolved when the neighbour is present.
     *
     * @see SubscriptionPresence  → `SubscriptionPresenceAdapter` (S1)
     * @see CustomerCreditPresence  → `CreditMemoPresenceAdapter` (S1)
     * @see B2bSignatoryPresence  → `PendingB2bSignatoryQuery` (B2)
     * @see OrderAnonymisation  → `OrderSnapshotRedaction` (orders)
     */
    public function register(): void
    {
        $this->app->bind(AreaServiceLookup::class, DeliveryZoneAreaService::class);

        $this->app->bindIf(SubscriptionPresence::class, NullSubscriptionPresence::class);
        $this->app->bindIf(CustomerCreditPresence::class, NullCustomerCreditPresence::class);
        $this->app->bindIf(B2bSignatoryPresence::class, NullB2bSignatoryPresence::class);
        $this->app->bindIf(OrderAnonymisation::class, OrderSnapshotAnonymiser::class);

        $this->registerClosureBlockers();
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__.'/../../resources/views', 'customers');
    }

    /**
     * The blocker registry, in the order a customer reads it.
     *
     * **Registered explicitly rather than discovered.** The sequence is a
     * product decision — the things a person can act on themselves first
     * (orders, subscriptions), then the things somebody else must act on
     * (memberships, signatures), then what the platform owes them, then the
     * honest not-applicables — and directory order is not a product decision.
     *
     * `CreditMemoBlocker` is seventh and sits where it does because of what it
     * says rather than what it stops: it is the only `advisory` in the list, and
     * a customer reads it after the things that actually stand in their way and
     * before the two that report having checked nothing.
     *
     * A singleton because the list is fixed for the lifetime of the process and
     * because the payment tripwire test resolves it to ask what is registered;
     * two registries would be two answers to that question.
     */
    private function registerClosureBlockers(): void
    {
        $this->app->singleton(ClosureBlockerRegistry::class, static fn (Application $app): ClosureBlockerRegistry => new ClosureBlockerRegistry([
            $app->make(OpenOrdersBlocker::class),
            $app->make(ActiveSubscriptionsBlocker::class),
            $app->make(ActiveOrganisationMembershipsBlocker::class),
            $app->make(PendingB2bSignatoryBlocker::class),
            $app->make(CreditMemoBlocker::class),
            $app->make(WalletBalanceBlocker::class),
            $app->make(PaymentMethodsBlocker::class),
        ]));
    }
}
