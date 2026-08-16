<?php

declare(strict_types=1);

use Carbon\CarbonImmutable;
use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\PlanMenuEntry;
use Healthy360\Catalogues\Models\SubscriptionPlanProfile;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
|--------------------------------------------------------------------------
| The fixed menu of a subscription plan
|--------------------------------------------------------------------------
|
| The table four docblocks had been waiting for: what a fixed-menu plan serves,
| on which day of its cycle. Three things get the most attention here, because
| each is a place the design could quietly go wrong:
|
|   - the cycle arithmetic, including **before** the anchor, where a single
|     modulo produces a day number that does not exist;
|   - replace-not-merge, and a coordinate swap inside one submission, which the
|     delete-all-before-insert ordering exists for;
|   - the refusals — the dish must be this kitchen's, a meal, and published;
|     the plan must be editable and must already have commercial terms.
|
| The menu is also the per-plan stock cut-over: a plan with entries generates
| meal lines that deduct, and a plan without them does not. Nothing in this
| suite exercises that — it belongs to the commit that wires the consequences —
| but it is why every refusal here is a refusal rather than a coercion.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('menu@catalogue.test');
    $this->headers = CatalogueWorld::headers($this->a);

    $this->plan = CatalogueWorld::plan($this->a);
    $this->chicken = CatalogueWorld::publishedMeal($this->a, 'Grilled chicken');
    $this->fish = CatalogueWorld::publishedMeal($this->a, 'Baked fish');

    $this->actingAs($this->a->user);

    // Every menu write needs commercial terms to hang on, so the profile is
    // written first — and the one test that checks the refusal deletes it
    // again.
    SubscriptionPlanProfile::factory()->create([
        'catalogue_item_id' => $this->plan->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    $this->menu = fn (array $entries, ?int $cycleDays, ?string $anchor, string $lockVersion) => $this->putJson(
        '/api/v1/catalogue/plans/'.$this->plan->getKey().'/menu',
        [
            'entries' => $entries,
            'menu_cycle_days' => $cycleDays,
            'menu_cycle_anchor_date' => $anchor,
        ],
        $this->headers + ['If-Match' => '"'.$lockVersion.'"'],
    );

    $this->entry = fn (int $day, string $slot, CatalogueItem $meal, ?int $sequence = null): array => array_filter([
        'cycle_day' => $day,
        'slot' => $slot,
        'meal_catalogue_item_id' => (string) $meal->getKey(),
        'sequence' => $sequence,
    ], static fn (mixed $value): bool => $value !== null);
});

/*
| The cycle arithmetic
*/

it('resolves a date to its day of the cycle, forwards from the anchor', function (): void {
    $anchor = CarbonImmutable::parse('2026-08-16');

    // Day 1 is the anchor itself, not the day after it.
    expect(PlanMenuEntry::cycleDayFor($anchor, $anchor, 7))->toBe(1)
        ->and(PlanMenuEntry::cycleDayFor($anchor->addDays(1), $anchor, 7))->toBe(2)
        ->and(PlanMenuEntry::cycleDayFor($anchor->addDays(6), $anchor, 7))->toBe(7)
        // And it wraps rather than running off the end.
        ->and(PlanMenuEntry::cycleDayFor($anchor->addDays(7), $anchor, 7))->toBe(1)
        ->and(PlanMenuEntry::cycleDayFor($anchor->addDays(100), $anchor, 7))->toBe(3);
});

it('resolves a date before the anchor without producing a day that does not exist', function (): void {
    // The double modulo exists for this. A single `%` keeps the sign of the
    // left operand, so the day before the anchor of a 7-day cycle would be
    // `-1 % 7 + 1 = 0` — and there is no day zero.
    $anchor = CarbonImmutable::parse('2026-08-16');

    expect(PlanMenuEntry::cycleDayFor($anchor->subDays(1), $anchor, 7))->toBe(7)
        ->and(PlanMenuEntry::cycleDayFor($anchor->subDays(2), $anchor, 7))->toBe(6)
        ->and(PlanMenuEntry::cycleDayFor($anchor->subDays(7), $anchor, 7))->toBe(1)
        ->and(PlanMenuEntry::cycleDayFor($anchor->subDays(8), $anchor, 7))->toBe(7)
        ->and(PlanMenuEntry::cycleDayFor($anchor->subDays(100), $anchor, 7))->toBe(6);

    // Every answer is inside the cycle, in both directions, at every length.
    foreach ([1, 2, 3, 5, 7, 14, 28] as $cycleDays) {
        foreach (range(-40, 40) as $offset) {
            $day = PlanMenuEntry::cycleDayFor($anchor->addDays($offset), $anchor, $cycleDays);

            expect($day)->toBeGreaterThanOrEqual(1)->toBeLessThanOrEqual($cycleDays);
        }
    }
});

it('ignores the time of day on both sides', function (): void {
    // The column is a date and the cycle turns over at the kitchen's midnight.
    // An anchor carrying a time would otherwise shift every answer by a day
    // depending on which side of it a request landed.
    $anchor = CarbonImmutable::parse('2026-08-16 23:30:00');

    expect(PlanMenuEntry::cycleDayFor(CarbonImmutable::parse('2026-08-16 00:05:00'), $anchor, 7))->toBe(1)
        ->and(PlanMenuEntry::cycleDayFor(CarbonImmutable::parse('2026-08-17 00:05:00'), $anchor, 7))->toBe(2);
});

/*
| The write path
*/

it('writes a menu and the cycle it runs on, and serves both back', function (): void {
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
        ($this->entry)(1, 'dinner', $this->fish),
        ($this->entry)(2, 'lunch', $this->fish),
    ], 7, '2026-08-16', '0')
        ->assertOk()
        ->assertJsonPath('meta.count', 3)
        ->assertJsonPath('data.cycle.cycle_days', 7)
        ->assertJsonPath('data.cycle.anchor_date', '2026-08-16')
        ->assertHeader('ETag', '"1"');

    // The cycle is written onto the profile, which is where every downstream
    // reader looks for "does this plan have a menu".
    $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($this->plan->getKey())->sole();

    expect($profile->menu_cycle_days)->toBe(7)
        ->and($profile->menu_cycle_anchor_date?->toDateString())->toBe('2026-08-16')
        ->and(PlanMenuEntry::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->count())->toBe(3);

    // The read serves exactly what the write stored, in the order a chef reads
    // it — day, then sitting in the order of the day, then sequence.
    $read = $this->getJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/menu', $this->headers)
        ->assertOk()
        ->assertHeader('ETag', '"1"')
        ->assertJsonPath('data.cycle.cycle_days', 7)
        ->assertJsonPath('meta.count', 3)
        ->json('data.entries');

    expect(array_map(static fn (array $row): string => $row['cycle_day'].':'.$row['slot'], $read))
        ->toBe(['1:lunch', '1:dinner', '2:lunch'])
        ->and($read[0]['meal_catalogue_item_id'])->toBe((string) $this->chicken->getKey())
        // The dish's name travels with the entry so an editor drawing a week of
        // slots does not have to resolve forty identifiers to do it.
        ->and($read[0]['meal_name_en'])->toBe('Grilled chicken')
        ->and($read[0]['sequence'])->toBe(1);
});

it('replaces rather than merges, so a shorter submission removes the rest', function (): void {
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
        ($this->entry)(2, 'lunch', $this->fish),
        ($this->entry)(3, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '0')->assertOk();

    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '1')
        ->assertOk()
        ->assertJsonPath('meta.count', 1);

    // Deleted, not archived. Nothing references a menu entry — no price is
    // quoted against it and generation copies the dish rather than the entry —
    // and the dish itself is protected by its own restrictOnDelete.
    expect(PlanMenuEntry::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->count())->toBe(1);
});

it('lets two days swap their dishes in one submission', function (): void {
    // The delete-all-before-insert ordering exists for exactly this: updating
    // in place would trip the unique index halfway through.
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
        ($this->entry)(2, 'lunch', $this->fish),
    ], 7, '2026-08-16', '0')->assertOk();

    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->fish),
        ($this->entry)(2, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '1')->assertOk();

    $byDay = PlanMenuEntry::withoutTenancy()
        ->where('catalogue_item_id', $this->plan->getKey())
        ->get()
        ->keyBy('cycle_day');

    expect($byDay->get(1)?->meal_catalogue_item_id)->toBe((string) $this->fish->getKey())
        ->and($byDay->get(2)?->meal_catalogue_item_id)->toBe((string) $this->chicken->getKey());
});

it('keeps the kitchen that serves lunch twice representable', function (): void {
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
        ($this->entry)(1, 'lunch', $this->fish, 2),
    ], 7, '2026-08-16', '0')
        ->assertOk()
        ->assertJsonPath('meta.count', 2);
});

it('withdraws the menu when the entries and the cycle are both cleared', function (): void {
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '0')->assertOk();

    ($this->menu)([], null, null, '1')
        ->assertOk()
        ->assertJsonPath('meta.count', 0)
        ->assertJsonPath('data.cycle.cycle_days', null)
        ->assertJsonPath('data.cycle.anchor_date', null);

    $profile = SubscriptionPlanProfile::withoutTenancy()->whereKey($this->plan->getKey())->sole();

    // The plan is back to the behaviour every plan has today: no menu, no
    // generated meal lines, no stock movement.
    expect($profile->menu_cycle_days)->toBeNull()
        ->and($profile->menu_cycle_anchor_date)->toBeNull()
        ->and(PlanMenuEntry::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->count())->toBe(0);
});

it('records the replacement with counts and the new validator', function (): void {
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
        ($this->entry)(2, 'lunch', $this->fish),
    ], 7, '2026-08-16', '0')->assertOk();

    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->fish),
    ], 7, '2026-08-16', '1')->assertOk();

    $events = AuditLog::query()->where('action', 'catalogue.plan_menu_replaced')->orderBy('created_at')->get();

    expect($events)->toHaveCount(2)
        ->and($events->first()->metadata['entry_count'])->toBe(2)
        ->and($events->first()->metadata['removed_count'])->toBe(0)
        ->and($events->first()->metadata['lock_version'])->toBe(1)
        ->and($events->last()->metadata['entry_count'])->toBe(1)
        ->and($events->last()->metadata['removed_count'])->toBe(2)
        ->and($events->last()->metadata['cycle_days'])->toBe(7)
        ->and($events->last()->metadata['anchor_date'])->toBe('2026-08-16');
});

/*
| The refusals
*/

it('refuses a menu on a plan whose commercial terms nobody has written', function (): void {
    // Creating the profile is not this service's job: "nobody has decided the
    // terms" is exactly the distinction the publish gate reads, and a menu
    // service that quietly answered it would answer it wrong.
    SubscriptionPlanProfile::withoutTenancy()->whereKey($this->plan->getKey())->delete();

    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '0')
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonPath('error.details.reason', 'plan_profile_missing');

    // The refusal costs the caller nothing: the validator is untouched, so the
    // If-Match they already hold still works once they write the terms.
    expect(CatalogueItem::withoutTenancy()->whereKey($this->plan->getKey())->value('lock_version'))->toBe(0);
});

it('refuses a dish belonging to another kitchen', function (): void {
    $b = CatalogueWorld::kitchen('other-menu@catalogue.test');
    $theirs = CatalogueWorld::publishedMeal($b, 'Their soup');

    ($this->menu)([
        ($this->entry)(1, 'lunch', $theirs),
    ], 7, '2026-08-16', '0')
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(PlanMenuEntry::withoutTenancy()->count())->toBe(0);
});

it('refuses a dish that is not published, because an entry is a promise to serve it', function (): void {
    $draft = CatalogueItem::factory()->meal()->create([
        'catalogue_id' => $this->a->catalogue->getKey(),
        'organisation_id' => $this->a->organisation->getKey(),
    ]);

    ($this->menu)([
        ($this->entry)(1, 'lunch', $draft),
    ], 7, '2026-08-16', '0')->assertStatus(422);

    $retired = CatalogueWorld::publishedMeal($this->a, 'Withdrawn dish');
    CatalogueItem::withoutTenancy()->whereKey($retired->getKey())->update(['status' => 'retired']);

    ($this->menu)([
        ($this->entry)(1, 'lunch', $retired),
    ], 7, '2026-08-16', '0')->assertStatus(422);
});

it('refuses a dish that is not a meal', function (): void {
    $product = CatalogueWorld::publishableProduct($this->a);
    CatalogueItem::withoutTenancy()->whereKey($product->getKey())->update(['status' => 'published']);

    ($this->menu)([
        ($this->entry)(1, 'lunch', $product->refresh()),
    ], 7, '2026-08-16', '0')->assertStatus(422);
});

it('refuses a day the cycle does not have', function (): void {
    ($this->menu)([
        ($this->entry)(8, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '0')
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');
});

it('refuses half a menu in either direction', function (): void {
    // Dishes with no cycle: nothing to resolve a date against.
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
    ], null, null, '0')->assertStatus(422);

    // A cycle with no dishes is the worse half: it announces a published menu
    // whose every day is empty.
    ($this->menu)([], 7, '2026-08-16', '0')->assertStatus(422);

    // A cycle with no anchor has nothing to start counting from.
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
    ], 7, null, '0')->assertStatus(422);
});

it('refuses one slot filled twice in a single submission', function (): void {
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
        ($this->entry)(1, 'lunch', $this->fish),
    ], 7, '2026-08-16', '0')->assertStatus(422);

    expect(PlanMenuEntry::withoutTenancy()->count())->toBe(0);
});

it('refuses a slot outside the four sittings', function (): void {
    ($this->menu)([
        ['cycle_day' => 1, 'slot' => 'brunch', 'meal_catalogue_item_id' => (string) $this->chicken->getKey()],
    ], 7, '2026-08-16', '0')->assertStatus(422);
});

it('refuses to touch the menu of a retired plan', function (): void {
    CatalogueItem::withoutTenancy()->whereKey($this->plan->getKey())->update(['status' => 'retired']);

    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '0')
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('refuses the whole menu family on an item that is not a subscription plan', function (): void {
    $product = CatalogueWorld::publishableProduct($this->a, 'Not a plan');

    $this->getJson('/api/v1/catalogue/plans/'.$product->getKey().'/menu', $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.details.item_type', 'product');

    $this->putJson(
        '/api/v1/catalogue/plans/'.$product->getKey().'/menu',
        ['entries' => [], 'menu_cycle_days' => null, 'menu_cycle_anchor_date' => null],
        $this->headers + ['If-Match' => '"0"'],
    )->assertStatus(422);
});

it('requires the items validator on the menu and refuses a stale one', function (): void {
    $this->putJson(
        '/api/v1/catalogue/plans/'.$this->plan->getKey().'/menu',
        ['entries' => [], 'menu_cycle_days' => null, 'menu_cycle_anchor_date' => null],
        $this->headers,
    )
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');

    ($this->menu)([], null, null, '7')
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('refuses to delete a meal that is on a menu', function (): void {
    // The dish's own restrictOnDelete is what protects it — which is precisely
    // why the entries themselves can be plainly deleted.
    ($this->menu)([
        ($this->entry)(1, 'lunch', $this->chicken),
    ], 7, '2026-08-16', '0')->assertOk();

    // A savepoint, so the refusal does not abort the transaction the test runs
    // inside and the row can still be looked for afterwards.
    expect(fn () => DB::transaction(fn () => CatalogueItem::withoutTenancy()->whereKey($this->chicken->getKey())->delete()))
        ->toThrow(QueryException::class);

    expect(DB::table('catalogue_items')->where('id', $this->chicken->getKey())->exists())->toBeTrue();
});

/*
| The constraints underneath, which have to hold for an importer and a console
| session as well as for the service.
*/

it('refuses a slot the database does not recognise', function (): void {
    // Every write in a savepoint: a refused statement aborts the transaction
    // the test runs inside, and without one the second assertion would pass
    // for the wrong reason.
    $insert = fn (string $slot, int $cycleDay = 1, int $sequence = 1) => DB::transaction(fn () => DB::table('plan_menu_entries')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $this->plan->getKey(),
        'cycle_day' => $cycleDay,
        'slot' => $slot,
        'sequence' => $sequence,
        'meal_catalogue_item_id' => $this->chicken->getKey(),
        'created_at' => now(),
        'updated_at' => now(),
    ]));

    // The four `subscription_meal_choices` stores, and only those: generation
    // copies this string straight onto a choice row.
    foreach (['breakfast', 'lunch', 'dinner', 'snack'] as $index => $slot) {
        expect($insert($slot, $index + 1))->toBeTrue();
    }

    expect(fn () => $insert('brunch', 5))->toThrow(QueryException::class)
        ->and(fn () => $insert('', 6))->toThrow(QueryException::class);

    expect(DB::table('plan_menu_entries')->count())->toBe(4);
});

it('refuses a cycle day or a sequence below one', function (): void {
    $insert = fn (int $cycleDay, int $sequence) => DB::transaction(fn () => DB::table('plan_menu_entries')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $this->plan->getKey(),
        'cycle_day' => $cycleDay,
        'slot' => 'lunch',
        'sequence' => $sequence,
        'meal_catalogue_item_id' => $this->chicken->getKey(),
        'created_at' => now(),
        'updated_at' => now(),
    ]));

    expect(fn () => $insert(0, 1))->toThrow(QueryException::class)
        ->and(fn () => $insert(-1, 1))->toThrow(QueryException::class)
        ->and(fn () => $insert(1, 0))->toThrow(QueryException::class);

    expect(DB::table('plan_menu_entries')->count())->toBe(0);
});

it('refuses one dish per slot at the database as well', function (): void {
    // What makes the service's coordinate rule true of an importer and a
    // console session too.
    $insert = fn (CatalogueItem $meal) => DB::transaction(fn () => DB::table('plan_menu_entries')->insert([
        'id' => (string) Str::uuid7(),
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_id' => $this->plan->getKey(),
        'cycle_day' => 1,
        'slot' => 'lunch',
        'sequence' => 1,
        'meal_catalogue_item_id' => $meal->getKey(),
        'created_at' => now(),
        'updated_at' => now(),
    ]));

    expect($insert($this->chicken))->toBeTrue()
        ->and(fn () => $insert($this->fish))->toThrow(QueryException::class);
});

it('refuses a menu cycle of zero days on the profile', function (): void {
    expect(fn () => DB::transaction(fn () => DB::table('subscription_plan_profiles')
        ->where('catalogue_item_id', $this->plan->getKey())
        ->update(['menu_cycle_days' => 0])))
        ->toThrow(QueryException::class);

    // Null is the whole "no menu" fact and stays legal.
    expect(DB::table('subscription_plan_profiles')
        ->where('catalogue_item_id', $this->plan->getKey())
        ->update(['menu_cycle_days' => null]))->toBe(1);
});
