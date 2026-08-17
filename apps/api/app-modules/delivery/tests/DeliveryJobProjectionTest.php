<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Delivery\Services\DeliveryJobProjector;
use Healthy360\Orders\Contracts\DeliveryJobProjection;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Services\OrderLifecycle;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| Confirming a delivery order makes a run somebody has to drive (C3)
|--------------------------------------------------------------------------
|
| `delivery_jobs` existed from F1 with no producer at all — the table, the
| dispatch board and the driver's run sheet were built and the rows were written
| by fixtures. This suite is about the producer: `OrderLifecycle::confirm()`
| firing `DeliveryJobProjection`, answered by this module's projector.
|
| Three things can go wrong with that and none of them is loud.
|
| **The gate.** The port is fired only for `FulfilmentType::Delivery`. A pickup
| or a counter sale that grew a delivery job would put a run on a dispatch board
| for food nobody is taking anywhere, and the board is the surface a human works
| from — a phantom row there costs a phone call, every time.
|
| **The idempotency.** The projection runs inside the confirm's own transaction,
| in a closure that re-runs on a retried confirm. Two jobs for one order is two
| drivers at one door, and the only guarantee that survives concurrency is the
| unique index plus a 23505 catch. The catch has a second, quieter job as well:
| in PostgreSQL an error aborts the enclosing transaction, so without the nested
| savepoint the projector opens, the *second* projection would take the whole
| confirm down with it. That is pinned here by projecting twice and then reading
| inside the same transaction.
|
| **The tenancy.** A confirm can arrive from a console command or a queued job
| with no `TenantContext` published, and every model in this module is
| fail-closed. The projector therefore takes the organisation from the order and
| reads nothing through the scope — asserted rather than assumed, because the
| failure mode is a background run that stops dispatching and says nothing.
|
| The cancel assertions are the other half of the design: a cancelled order keeps
| its run, because a job's own lifecycle belongs to this module and deleting one
| would erase the fact that a driver was sent.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('projection@delivery.test');
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation)->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();
    $this->branchId = (string) OrganisationBranch::withoutTenancy()->create([
        'organisation_id' => $this->orgId,
        'name' => 'Main kitchen',
        'country_code' => 'LB',
        'city' => 'Beirut',
        'timezone' => 'Asia/Beirut',
        'status' => 'active',
        'lock_version' => 0,
    ])->getKey();

    app(TenantContext::class)->setOrganisation(
        (string) $this->tenant->user->getKey(),
        $this->orgId,
    );
});

/**
 * An order on this kitchen's book. Built through the factory rather than through
 * placement: this suite asserts what `confirm()` does to an order, and going
 * through `OrderPlacementService` would drag a priced channel, a served zone and
 * an eligible customer into a test that asserts none of them.
 *
 * @param  array<string, mixed>  $attributes
 */
function projectedOrder(object $test, array $attributes = []): Order
{
    return Order::factory()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
        ...$attributes,
    ]);
}

/**
 * @return list<DeliveryJob>
 */
function jobsFor(Order $order): array
{
    return DeliveryJob::withoutTenancy()->where('order_id', $order->getKey())->get()->all();
}

it('binds the delivery module\'s projector over the orders module\'s null default', function (): void {
    // The whole port is inert if the binding order is wrong: `boot()` over
    // `register()` is what makes this module win whatever order package
    // discovery puts the two in, and a null projection would fail nothing else
    // in this file that a missing gate would not also fail.
    expect(app(DeliveryJobProjection::class))->toBeInstanceOf(DeliveryJobProjector::class);
});

it('creates a job when a delivery order is confirmed', function (): void {
    $order = projectedOrder($this, ['branch_id' => $this->branchId]);

    app(OrderLifecycle::class)->confirm($order);

    $jobs = jobsFor($order);

    expect($jobs)->toHaveCount(1);

    $job = $jobs[0];

    expect($job->organisation_id)->toBe($this->orgId)
        // The branch is copied from the order rather than resolved: a run
        // belongs to the site that cooks it, and both columns are legitimately
        // null when nobody named one.
        ->and($job->branch_id)->toBe($this->branchId)
        // The state a run is born in, on both axes. `pending` is what a
        // dispatcher sees and `awaiting_assignment` is what a customer would be
        // told; they are written explicitly rather than left to the column
        // defaults, so a default that moved could not move the state silently.
        ->and($job->status)->toBe('pending')
        ->and($job->tracking_status)->toBe('awaiting_assignment')
        ->and($job->driver_user_id)->toBeNull()
        ->and($job->assigned_at)->toBeNull()
        ->and($job->lock_version)->toBe(0);
});

it('creates no job for a pickup order', function (): void {
    $order = Order::factory()->pickup()->create([
        'organisation_id' => $this->orgId,
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => $this->channelId,
    ]);

    app(OrderLifecycle::class)->confirm($order);

    expect(jobsFor($order))->toHaveCount(0);
});

it('creates no job for a counter sale', function (): void {
    $order = Order::factory()->counter()->create([
        'organisation_id' => $this->orgId,
        'sales_channel_id' => $this->channelId,
    ]);

    app(OrderLifecycle::class)->confirm($order);

    expect(jobsFor($order))->toHaveCount(0);
});

it('creates no job when an order is cancelled without ever being confirmed', function (): void {
    // `cancel()` fires the stock reversal and nothing else. A run is a
    // consequence of a kitchen committing to cook, and nobody committed here.
    $order = projectedOrder($this);

    app(OrderLifecycle::class)->cancel($order, CancellationReason::CustomerRequested);

    expect(jobsFor($order))->toHaveCount(0);
});

it('leaves the run in place when a confirmed delivery order is cancelled', function (): void {
    // The deliberate asymmetry with stock, and the reason the port offers no
    // reverse: a delivery job is a record of work whose own status lifecycle is
    // this module's business, worked on the dispatch board. Deleting it would
    // erase the fact that a driver was sent, possibly while they are holding the
    // food.
    $order = projectedOrder($this);

    $confirmed = app(OrderLifecycle::class)->confirm($order);
    app(OrderLifecycle::class)->cancel($confirmed, CancellationReason::KitchenUnableToFulfil);

    expect(jobsFor($order))->toHaveCount(1);
});

it('projects the same order twice without creating a second run', function (): void {
    $order = projectedOrder($this);

    $projector = app(DeliveryJobProjection::class);

    $projector->project($order);
    $projector->project($order);

    expect(jobsFor($order))->toHaveCount(1);
});

it('survives a repeat projection inside an open transaction rather than poisoning it', function (): void {
    // The failure this guards is not a duplicate row, it is PostgreSQL's
    // *current transaction is aborted* — a 23505 with no savepoint under it
    // would take the enclosing confirm down and every statement after it. The
    // read at the end is the assertion: it only runs if the transaction is
    // still usable.
    $order = projectedOrder($this);

    $count = DB::transaction(function () use ($order): int {
        $projector = app(DeliveryJobProjection::class);

        $projector->project($order);
        $projector->project($order);

        return DeliveryJob::withoutTenancy()->where('order_id', $order->getKey())->count();
    });

    expect($count)->toBe(1);
});

it('projects with no tenant context published at all', function (): void {
    // The background path: `subscriptions:generate` and any console confirm run
    // with no organisation resolved, and `DeliveryJob` is fail-closed. The
    // organisation comes off the order — which is the more trustworthy source
    // anyway, since a run belongs to the kitchen that sold the food and never to
    // whichever tenant happened to be in context.
    $order = projectedOrder($this);

    app(TenantContext::class)->clear();

    app(DeliveryJobProjection::class)->project($order);

    $jobs = jobsFor($order);

    expect($jobs)->toHaveCount(1)
        ->and($jobs[0]->organisation_id)->toBe($this->orgId);
});

it('projects a run for a subscription-generated order, which is intended', function (): void {
    // `GenerationService` composes a `ComposedPlacement` without naming a
    // fulfilment type, and that parameter defaults to `Delivery` — so every
    // order the nightly generation produces is a delivery order and every one of
    // them gets a run when the kitchen confirms it. That is the correct
    // behaviour and not an accident of the gate: a subscription delivery is a
    // delivery, and a kitchen that could not see tonight's twenty subscription
    // runs on its dispatch board would be dispatching from a screen missing most
    // of its work.
    //
    // The shape is what a generated order actually looks like: nobody placed it
    // on anybody's behalf, and there is no desk agent behind it. The projection
    // gates on `fulfilment_type` alone and asks nothing about provenance, which
    // is what this pins.
    $order = projectedOrder($this, [
        'placed_on_behalf_by' => null,
        'created_by' => null,
    ]);

    app(OrderLifecycle::class)->confirm($order);

    expect(jobsFor($order))->toHaveCount(1);
});
