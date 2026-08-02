<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Kitchens\Models\BranchOpeningHour;
use Healthy360\Kitchens\Tests\Fixtures\KitchenWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| A branch's operating week
|--------------------------------------------------------------------------
|
| The table reviewer point 19 exposed: the wire contract already carried
| opening hours and an order cut-off while the Kitchens module had no schema
| at all.
|
| Three things are proven here. The **week is the unit of change**, replaced
| atomically, which is why there is no `If-Match`. A **closed day is a row**,
| distinguishable from a day nobody has configured. And the **branch comes from
| the context**, never from the body — with no branch selected the endpoint
| refuses rather than guessing which location the caller meant.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = KitchenWorld::kitchen('hours@kitchen.test');
    $this->headers = KitchenWorld::branchHeaders($this->a);

    $this->actingAs($this->a->user);
});

it('starts with an unconfigured week rather than an invented one', function (): void {
    // Absent, not filled in: `is_open: false` for a day nobody has decided
    // about would tell a customer the branch is shut when the truth is that
    // nobody has said.
    $this->getJson('/api/v1/kitchen/branch-operating', $this->headers)
        ->assertOk()
        ->assertJsonCount(0, 'data')
        ->assertJsonPath('meta.configured_weekdays', [])
        ->assertJsonPath('meta.is_complete', false);
});

it('replaces the whole week in one write', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => KitchenWorld::openWeek(),
    ], $this->headers)
        ->assertOk()
        ->assertJsonCount(7, 'data')
        ->assertJsonPath('meta.is_complete', true)
        ->assertJsonPath('meta.open_day_count', 7)
        // HH:MM on the wire, in the branch's own timezone.
        ->assertJsonPath('data.0.opens_at', '08:00')
        ->assertJsonPath('data.0.order_cut_off_at', '18:00');
});

it('stores a closed day as a row', function (): void {
    // The distinction the whole table exists for: "we are shut on Friday" is a
    // row with no times, and only that lets a checkout explain a refusal.
    $week = KitchenWorld::openWeek();
    $week[4] = ['weekday' => 5, 'opens_at' => null, 'closes_at' => null, 'order_cut_off_at' => null];

    $this->putJson('/api/v1/kitchen/branch-operating', ['days' => $week], $this->headers)
        ->assertOk()
        ->assertJsonCount(7, 'data')
        ->assertJsonPath('meta.open_day_count', 6)
        ->assertJsonPath('data.4.weekday', 5)
        ->assertJsonPath('data.4.is_open', false)
        ->assertJsonPath('data.4.opens_at', null);

    expect(BranchOpeningHour::withoutTenancy()->where('branch_id', $this->a->branch->getKey())->count())->toBe(7);
});

it('returns the week in weekday order however it was submitted', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [
            ['weekday' => 3, 'opens_at' => '08:00', 'closes_at' => '20:00'],
            ['weekday' => 1, 'opens_at' => '08:00', 'closes_at' => '20:00'],
        ],
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.weekday', 1)
        ->assertJsonPath('data.1.weekday', 3)
        ->assertJsonPath('meta.configured_weekdays', [1, 3]);
});

it('clears the week when the body is empty', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', ['days' => KitchenWorld::openWeek()], $this->headers)->assertOk();

    $this->putJson('/api/v1/kitchen/branch-operating', ['days' => []], $this->headers)
        ->assertOk()
        ->assertJsonCount(0, 'data');
});

it('refuses half a day', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 1, 'opens_at' => '08:00']],
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['days.0.closes_at']]]]);
});

it('refuses a branch that closes before it opens', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 1, 'opens_at' => '20:00', 'closes_at' => '08:00']],
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['days.0.closes_at']]]]);
});

it('refuses a cut-off on a closed day', function (): void {
    // A time nobody can act on. A system that stored it would eventually read
    // it.
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 5, 'opens_at' => null, 'closes_at' => null, 'order_cut_off_at' => '18:00']],
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['days.0.order_cut_off_at']]]]);
});

it('accepts an open day with no cut-off at all', function (): void {
    // A kitchen that takes orders until the van leaves has no cut-off, and
    // NULL says that honestly.
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 1, 'opens_at' => '08:00', 'closes_at' => '20:00']],
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.order_cut_off_at', null);
});

it('accepts a cut-off outside the opening hours', function (): void {
    // "Order by 22:00 the night before for tomorrow morning" is a real rule,
    // and a constraint tying the cut-off to the same day's window would forbid
    // it. Which day a cut-off governs is C1's question.
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 1, 'opens_at' => '08:00', 'closes_at' => '14:00', 'order_cut_off_at' => '22:00']],
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.0.order_cut_off_at', '22:00');
});

it('refuses the same weekday twice', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [
            ['weekday' => 1, 'opens_at' => '08:00', 'closes_at' => '12:00'],
            ['weekday' => 1, 'opens_at' => '14:00', 'closes_at' => '20:00'],
        ],
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['days.1.weekday']]]]);
});

it('refuses a weekday outside the ISO range', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 0, 'opens_at' => '08:00', 'closes_at' => '20:00']],
    ], $this->headers)->assertStatus(422);

    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 8, 'opens_at' => '08:00', 'closes_at' => '20:00']],
    ], $this->headers)->assertStatus(422);
});

it('refuses to answer with no branch selected', function (): void {
    // `branch.context` permits an absent header — an organisation-wide
    // membership may legitimately select no branch — so the requirement
    // belongs to the endpoint that genuinely cannot answer without one.
    $organisationOnly = KitchenWorld::headers($this->a);

    $this->getJson('/api/v1/kitchen/branch-operating', $organisationOnly)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'context.branch_required')
        ->assertJsonPath('error.details.required_headers.0', 'X-Branch-Id');

    $this->putJson('/api/v1/kitchen/branch-operating', ['days' => []], $organisationOnly)
        ->assertStatus(400)
        ->assertJsonPath('error.code', 'context.branch_required');
});

it('keeps each branch week to itself', function (): void {
    $this->putJson('/api/v1/kitchen/branch-operating', ['days' => KitchenWorld::openWeek()], $this->headers)->assertOk();

    $this->getJson('/api/v1/kitchen/branch-operating', KitchenWorld::branchHeaders($this->a, $this->a->secondBranch))
        ->assertOk()
        ->assertJsonCount(0, 'data');

    // …and replacing one branch's week leaves the other's alone.
    $this->putJson('/api/v1/kitchen/branch-operating', [
        'days' => [['weekday' => 1, 'opens_at' => '10:00', 'closes_at' => '16:00']],
    ], KitchenWorld::branchHeaders($this->a, $this->a->secondBranch))->assertOk();

    $this->getJson('/api/v1/kitchen/branch-operating', $this->headers)
        ->assertOk()
        ->assertJsonCount(7, 'data');
});

it('refuses a branch outside the caller membership scope', function (): void {
    // A branch-pinned membership may only operate in its own branch, and the
    // refusal comes from the context resolver before this module sees it.
    $pinned = KitchenWorld::kitchen('pinned@kitchen.test', branchScoped: true);

    $this->actingAs($pinned->user);

    $this->getJson('/api/v1/kitchen/branch-operating', KitchenWorld::branchHeaders($pinned, $pinned->secondBranch))
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'context.branch_out_of_scope');
});

it('never shows one organisation another branch week', function (): void {
    $b = KitchenWorld::kitchen('other-hours@kitchen.test');

    $this->getJson('/api/v1/kitchen/branch-operating', KitchenWorld::headers($this->a) + ['X-Branch-Id' => (string) $b->branch->getKey()])
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'context.branch_out_of_scope');
});

it('lets a reader read and refuses their write', function (): void {
    // The foundation `branch.*` pair does real work here: knowing when the
    // kitchen trades is not the same authority as deciding it.
    $reader = KitchenWorld::kitchen('reader@kitchen.test', ['branch.view_current']);

    $this->actingAs($reader->user);

    $this->getJson('/api/v1/kitchen/branch-operating', KitchenWorld::branchHeaders($reader))->assertOk();

    $this->putJson('/api/v1/kitchen/branch-operating', ['days' => []], KitchenWorld::branchHeaders($reader))
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');
});

it('audits the replacement with the closed days named', function (): void {
    $week = KitchenWorld::openWeek();
    $week[4] = ['weekday' => 5, 'opens_at' => null, 'closes_at' => null, 'order_cut_off_at' => null];

    $this->putJson('/api/v1/kitchen/branch-operating', ['days' => $week], $this->headers)->assertOk();

    $log = AuditLog::query()->where('action', 'kitchen.branch_operating_replaced')->sole();

    expect($log->subject_type)->toBe('organisation_branch')
        ->and($log->subject_id)->toBe((string) $this->a->branch->getKey())
        ->and($log->metadata['open_day_count'] ?? null)->toBe(6)
        ->and($log->metadata['closed_weekdays'] ?? null)->toBe([5])
        ->and($log->metadata['cut_off_day_count'] ?? null)->toBe(6)
        // `AuditRecorder` redacts any key containing `code` (OQ-036, R-019).
        ->and(array_filter((array) $log->metadata, static fn (mixed $value): bool => $value === '[redacted]'))->toBe([]);
});

it('backs every per-row rule with a database CHECK', function (): void {
    // The service refuses each of these with a sentence naming the day; the
    // CHECKs are what make them true for an importer or a backfill that never
    // reaches the service.
    $write = fn (array $attributes) => DB::transaction(fn () => BranchOpeningHour::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'branch_id' => $this->a->branch->getKey(),
    ] + $attributes));

    // Half a day.
    expect(fn () => $write(['weekday' => 1, 'opens_at' => '08:00:00', 'closes_at' => null]))
        ->toThrow(QueryException::class);

    // Closes before it opens.
    expect(fn () => $write(['weekday' => 2, 'opens_at' => '20:00:00', 'closes_at' => '08:00:00']))
        ->toThrow(QueryException::class);

    // A cut-off on a closed day.
    expect(fn () => $write(['weekday' => 3, 'opens_at' => null, 'closes_at' => null, 'order_cut_off_at' => '18:00:00']))
        ->toThrow(QueryException::class);

    // A weekday that is not one.
    expect(fn () => $write(['weekday' => 9, 'opens_at' => '08:00:00', 'closes_at' => '20:00:00']))
        ->toThrow(QueryException::class);
});

it('takes the week with the branch when the branch goes', function (): void {
    // Written through the factory rather than the endpoint: an HTTP write
    // leaves an audit row pointing at the branch, and `audit_logs.branch_id`
    // is deliberately restrictive — the trail outlives what it describes. The
    // cascade under test is the opening hours', which are the branch's own
    // body and meaningless without it.
    foreach ([1, 2, 3] as $weekday) {
        BranchOpeningHour::factory()->onWeekday($weekday)->create([
            'organisation_id' => $this->a->organisation->getKey(),
            'branch_id' => $this->a->branch->getKey(),
        ]);
    }

    $this->a->branch->delete();

    expect(BranchOpeningHour::withoutTenancy()->where('branch_id', $this->a->branch->getKey())->count())->toBe(0);
});
