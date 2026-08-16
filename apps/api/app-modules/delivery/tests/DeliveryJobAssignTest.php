<?php

declare(strict_types=1);

use App\Models\User;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Permission;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Customers\Database\Factories\CustomerAccountFactory;
use Healthy360\Delivery\Models\DeliveryJob;
use Healthy360\Orders\Models\Order;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\Organisations\Enums\MembershipStatus;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Pricing\Tests\Fixtures\PricingWorld;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| POST /delivery/jobs/{job}/assign — the first write two people can race
|--------------------------------------------------------------------------
|
| Everything before C3 on this table was a read or a driver stamping their own
| row. Assignment is different in three ways, and each one is a section of this
| file.
|
| **It is contended.** A dispatch board is a shared screen showing the same
| unassigned run and the same free driver to two dispatchers. `lock_version`
| arrived with this endpoint and the check is folded into the `UPDATE`'s own
| `WHERE`, so the stale-validator test is about there being *no window* between
| the check and the write rather than about the message a client reads.
|
| **It is authority.** The three reads on this table carry no permission code
| because they are narrowed by ownership; deciding whose evening this is, is not.
| The endpoint carries `order.manage_organisation` — the same code that confirms
| the order the run came from.
|
| **It names a person.** A uuid that is not an active member of this kitchen is
| refused as a field error rather than as a 404, because the job is real and what
| is wrong is one value in the body. The cross-organisation case is the one worth
| pinning: a courier who genuinely works for the kitchen next door is somebody,
| and it must still be a refusal.
|
| The re-assignment test is the deliberate permission rather than an oversight:
| drivers get sick, and a dispatcher who could not hand a run on would have no
| move except to cancel a delivery the customer is still expecting.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->tenant = PricingWorld::kitchen('dispatch@delivery.test', ['order.manage_organisation']);
    $this->organisation = $this->tenant->organisation;
    $this->orgId = (string) $this->organisation->getKey();
    $this->channelId = (string) PricingWorld::channel($this->organisation)->getKey();
    $this->customerId = (string) CustomerAccountFactory::new()->create()->getKey();

    $this->headers = firstPartyHeaders() + ['X-Organisation-Id' => $this->orgId];

    $this->driver = assignDriver($this->orgId, 'driver@delivery.test');

    $this->actingAs($this->tenant->user);
});

/**
 * A member of staff who can be sent out with the food. No role and no
 * permission: a driver is somebody with an **active membership**, which is the
 * whole of what the endpoint checks.
 */
function assignDriver(string $organisationId, string $email, MembershipStatus $status = MembershipStatus::Active): User
{
    $user = User::factory()->create(['email' => $email]);

    OrganisationMembership::factory()->create([
        'organisation_id' => $organisationId,
        'user_id' => $user->getKey(),
        'status' => $status,
    ]);

    return $user;
}

/**
 * A confirmed delivery order and the run it produced, written directly.
 *
 * Not through `OrderLifecycle::confirm()`: the projection has its own suite, and
 * this one is about what happens to a job that already exists.
 *
 * @param  array<string, mixed>  $attributes
 */
function assignableJob(object $test, array $attributes = []): DeliveryJob
{
    $order = Order::factory()->confirmed()->create([
        'organisation_id' => $test->orgId,
        'customer_account_id' => $test->customerId,
        'sales_channel_id' => $test->channelId,
    ]);

    return DeliveryJob::withoutTenancy()->create([
        'organisation_id' => $test->orgId,
        'order_id' => $order->getKey(),
        'status' => 'pending',
        'tracking_status' => 'awaiting_assignment',
        'lock_version' => 0,
        ...$attributes,
    ]);
}

/**
 * @return array<string, string>
 */
function ifMatch(object $test, int $lockVersion): array
{
    return $test->headers + ['If-Match' => '"'.$lockVersion.'"'];
}

it('stamps the driver, the moment and the state, and bumps the validator', function (): void {
    $job = assignableJob($this);

    $response = $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        ifMatch($this, 0),
    )->assertOk();

    $stored = DeliveryJob::withoutTenancy()->whereKey($job->getKey())->sole();

    expect($stored->driver_user_id)->toBe((string) $this->driver->getKey())
        ->and($stored->assigned_at)->not->toBeNull()
        ->and($stored->status)->toBe('assigned')
        ->and($stored->lock_version)->toBe(1)
        // `tracking_status` deliberately does not move. The customer-facing
        // vocabulary runs awaiting_assignment → picked_up → en_route → arrived →
        // delivered, and there is no value between the first two: telling
        // somebody their food had been picked up while it was still on the pass
        // would be a worse answer than saying nothing new.
        ->and($stored->tracking_status)->toBe('awaiting_assignment');

    // The response carries the new validator both ways round, so a dispatch
    // board can write again without re-reading the job.
    expect($response->json('data.job.lock_version'))->toBe(1)
        ->and($response->json('data.job.status'))->toBe('assigned')
        ->and($response->json('data.job.driver_user_id'))->toBe((string) $this->driver->getKey())
        ->and($response->json('data.job.assigned_at'))->toBeString()
        ->and($response->headers->get('ETag'))->toBe('"1"');
});

it('writes a delivery.job_assigned audit event against the job', function (): void {
    $job = assignableJob($this);

    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        ifMatch($this, 0),
    )->assertOk();

    $event = AuditLog::query()->where('action', 'delivery.job_assigned')->sole();

    // The subject is the **job**, not the order: this is the delivery module's
    // decision about the delivery module's row, and an order's trail should not
    // acquire entries for work its customer never sees.
    expect($event->subject_type)->toBe('delivery_job')
        ->and($event->subject_id)->toBe((string) $job->getKey())
        ->and($event->actor_user_id)->toBe((string) $this->tenant->user->getKey())
        ->and($event->metadata['driver_user_id'])->toBe((string) $this->driver->getKey());
});

it('refuses a stale validator with a conflict carrying the current state', function (): void {
    $job = assignableJob($this);

    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        ifMatch($this, 0),
    )->assertOk();

    // The second dispatcher, still holding the board they rendered before the
    // first one wrote.
    $second = assignDriver($this->orgId, 'second-driver@delivery.test');

    $response = $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $second->getKey()],
        ifMatch($this, 0),
    )->assertStatus(409);

    expect($response->json('error.code'))->toBe('resource.conflict')
        ->and($response->json('error.details.current_lock_version'))->toBe(1)
        ->and($response->json('error.details.driver_user_id'))->toBe((string) $this->driver->getKey());

    // And the first dispatcher's decision stands: a lost update is what the
    // validator exists to prevent, so the second write must have changed nothing.
    expect(DeliveryJob::withoutTenancy()->whereKey($job->getKey())->value('driver_user_id'))
        ->toBe((string) $this->driver->getKey());
});

it('refuses an assignment with no If-Match at all', function (): void {
    $job = assignableJob($this);

    // 428, not 409. The client has not lost a race, it never entered one, and
    // the fix is to read the job and retry with its validator.
    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        $this->headers,
    )
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');
});

it('refuses a driver who is not an active member of this kitchen', function (): void {
    $job = assignableJob($this);

    // Somebody real, working for the kitchen next door. The refusal must not
    // depend on the uuid naming nobody.
    $otherKitchen = PricingWorld::kitchen('elsewhere@delivery.test');
    $outsider = assignDriver((string) $otherKitchen->organisation->getKey(), 'outsider@delivery.test');

    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $outsider->getKey()],
        ifMatch($this, 0),
    )
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        // The same field key a shape rule would have produced, so a client has
        // one branch for "that is not a driver we can send".
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['driver_user_id']]]]);

    expect(DeliveryJob::withoutTenancy()->whereKey($job->getKey())->value('driver_user_id'))->toBeNull();
});

it('refuses a member whose membership is no longer active', function (): void {
    // An invitation nobody accepted, a suspension and an ended employment are
    // all rows in this table, and none of them is somebody a kitchen can send
    // out with its food.
    $job = assignableJob($this);
    $suspended = assignDriver($this->orgId, 'suspended@delivery.test', MembershipStatus::Suspended);

    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $suspended->getKey()],
        ifMatch($this, 0),
    )->assertStatus(422);
});

it('lets a dispatcher hand a run to a different driver under a fresh validator', function (): void {
    // Drivers get sick. This is the whole reason re-assignment is permitted, and
    // the validator is what makes it deliberate rather than sloppy: the second
    // dispatcher had to read the job *after* it was assigned, so they knew it
    // already had a driver.
    $job = assignableJob($this);
    $replacement = assignDriver($this->orgId, 'replacement@delivery.test');

    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        ifMatch($this, 0),
    )->assertOk();

    $first = DeliveryJob::withoutTenancy()->whereKey($job->getKey())->sole()->assigned_at;

    $this->travel(1)->minutes();

    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $replacement->getKey()],
        ifMatch($this, 1),
    )->assertOk();

    $stored = DeliveryJob::withoutTenancy()->whereKey($job->getKey())->sole();

    expect($stored->driver_user_id)->toBe((string) $replacement->getKey())
        ->and($stored->lock_version)->toBe(2)
        // Re-stamped, because the useful question is when the person now holding
        // the run was given it. Every earlier answer survives in the audit trail.
        ->and($stored->assigned_at->greaterThan($first))->toBeTrue();

    expect(AuditLog::query()->where('action', 'delivery.job_assigned')->count())->toBe(2);
});

it('refuses to assign a run that has already been delivered', function (): void {
    // Assignment sets `status = assigned`, and applying that to a finished job
    // would leave a row that is simultaneously assigned and stamped
    // `delivered_at`. "The driver is unwell" has no meaning once the food is at
    // the door.
    $job = assignableJob($this, [
        'status' => 'delivered',
        'tracking_status' => 'delivered',
        'delivered_at' => now(),
    ]);

    $response = $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        ifMatch($this, 0),
    )->assertStatus(409);

    expect($response->json('error.details.status'))->toBe('delivered');
});

it('cannot reach another kitchen\'s delivery job at all', function (): void {
    // Absent rather than forbidden: a 403 would confirm that the identifier
    // names something real, and the scope that makes it absent is the model's
    // own, which no query on this table can forget.
    $otherKitchen = PricingWorld::kitchen('foreign@delivery.test');

    $foreignOrder = Order::factory()->confirmed()->create([
        'organisation_id' => $otherKitchen->organisation->getKey(),
        'customer_account_id' => $this->customerId,
        'sales_channel_id' => PricingWorld::channel($otherKitchen->organisation)->getKey(),
    ]);

    $foreignJob = DeliveryJob::withoutTenancy()->create([
        'organisation_id' => $otherKitchen->organisation->getKey(),
        'order_id' => $foreignOrder->getKey(),
        'status' => 'pending',
        'tracking_status' => 'awaiting_assignment',
        'lock_version' => 0,
    ]);

    $this->postJson(
        '/api/v1/delivery/jobs/'.$foreignJob->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        ifMatch($this, 0),
    )
        ->assertStatus(404)
        ->assertJsonPath('error.code', 'resource.not_found');
});

it('refuses a caller who may read the book but not manage it', function (): void {
    $job = assignableJob($this);

    $reader = User::factory()->create(['email' => 'reader@delivery.test']);
    $membership = OrganisationMembership::factory()->create([
        'organisation_id' => $this->orgId,
        'user_id' => $reader->getKey(),
    ]);
    $role = Role::factory()->create(['organisation_id' => $this->orgId]);
    RolePermission::factory()->create([
        'organisation_id' => $this->orgId,
        'role_id' => $role->getKey(),
        'permission_id' => Permission::query()->where('code', 'order.view_organisation')->sole()->getKey(),
    ]);
    MembershipRole::factory()->create([
        'organisation_id' => $this->orgId,
        'membership_id' => $membership->getKey(),
        'role_id' => $role->getKey(),
    ]);

    forgetResolvedGuards();
    $this->actingAs($reader);

    $this->postJson(
        '/api/v1/delivery/jobs/'.$job->getKey().'/assign',
        ['driver_user_id' => (string) $this->driver->getKey()],
        ifMatch($this, 0),
    )
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');
});
