<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Enums\CancellationReason;
use Healthy360\Orders\Enums\OrderStatus;
use Healthy360\Orders\Models\Order;
use Healthy360\Orders\Tests\Fixtures\RunWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

function runCancelledRunsMigration(): void
{
    $migration = require dirname(__DIR__).'/database/migrations/2026_11_02_001601_cancel_delivery_jobs_of_cancelled_orders.php';
    $migration->up();
}

it('closes only a cancelled order\'s uncollected open run, once, and is quiet with nothing to do', function (): void {
    runCancelledRunsMigration();

    expect(DeliveryJob::withoutTenancy()->count())->toBe(0);

    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $world = RunWorld::build('cancelled-runs@kitchen.test');
    $cancelled = fn (): Order => RunWorld::order($world, [
        'status' => OrderStatus::Cancelled,
        'cancelled_at' => now(),
        'cancellation_reason' => CancellationReason::CustomerRequested,
    ]);

    $stale = RunWorld::job($world, $cancelled());
    $collected = RunWorld::inTransit($world, $cancelled());
    $failed = RunWorld::job($world, $cancelled(), ['status' => 'failed', 'failed_at' => now(), 'failure_reason' => 'no_answer']);
    $open = RunWorld::job($world, RunWorld::order($world));

    runCancelledRunsMigration();
    runCancelledRunsMigration();

    expect($stale->refresh()->status)->toBe('cancelled')
        ->and($stale->lock_version)->toBe(1)
        ->and($collected->refresh()->status)->toBe('in_transit')
        ->and($failed->refresh()->status)->toBe('failed')
        ->and($open->refresh()->status)->toBe('pending');
});
