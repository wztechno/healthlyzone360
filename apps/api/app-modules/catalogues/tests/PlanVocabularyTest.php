<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/*
|--------------------------------------------------------------------------
| The three vocabularies a plan's matrix is built out of
|--------------------------------------------------------------------------
|
| Meal combinations, energy bands and durations: a kitchen's own words, not the
| platform's. Created, edited, deactivated — never deleted, because a plan
| configuration points at them and a price points at that.
|
| The duration rule of §4.3 gets the most attention here, and deliberately. It
| is the one place in this slice where a *model* was changed rather than added:
| the zero-day sentinel is gone, and the tests below prove it is gone from both
| ends — the request layer refuses the two contradictory shapes with a sentence,
| and the CHECK constraint refuses them to any writer at all.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('planner@catalogue.test');
    $this->headers = CatalogueWorld::headers($this->a);

    $this->actingAs($this->a->user);
});

it('creates a meal combination and lists it', function (): void {
    $this->postJson('/api/v1/catalogue/plan-vocabulary/combinations', [
        'code' => 'lunch-dinner',
        'name_en' => 'Lunch and dinner',
        'name_ar' => 'الغداء والعشاء',
        'includes_lunch' => true,
        'includes_dinner' => true,
        'meals_per_day' => 2,
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.combination.code', 'lunch-dinner')
        ->assertJsonPath('data.combination.includes_breakfast', false)
        ->assertJsonPath('data.combination.meals_per_day', 2)
        ->assertJsonPath('data.combination.is_active', true);

    $this->getJson('/api/v1/catalogue/plan-vocabulary/combinations', $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.code', 'lunch-dinner');
});

it('refuses a combination that covers no sitting at all', function (): void {
    // A combination that delivers nothing is not a combination, and a plan
    // built on it would be a subscription to an empty box.
    $this->postJson('/api/v1/catalogue/plan-vocabulary/combinations', [
        'code' => 'nothing',
        'name_en' => 'Nothing',
        'meals_per_day' => 1,
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['includes_lunch']]]]);
});

it('refuses a duplicate code inside one organisation and allows it in another', function (): void {
    $payload = [
        'code' => 'lunch-dinner',
        'name_en' => 'Lunch and dinner',
        'includes_lunch' => true,
        'includes_dinner' => true,
        'meals_per_day' => 2,
    ];

    $this->postJson('/api/v1/catalogue/plan-vocabulary/combinations', $payload, $this->headers)->assertStatus(201);

    $this->postJson('/api/v1/catalogue/plan-vocabulary/combinations', $payload, $this->headers)
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');

    // The same code in another kitchen is not a collision: these are one
    // organisation's words, and two kitchens both calling something
    // "lunch-dinner" is the expected case.
    $b = CatalogueWorld::kitchen('other-planner@catalogue.test');

    forgetResolvedGuards();
    $this->actingAs($b->user);

    $this->postJson('/api/v1/catalogue/plan-vocabulary/combinations', $payload, CatalogueWorld::headers($b))
        ->assertStatus(201);
});

it('deactivates a combination rather than offering any way to delete one', function (): void {
    $combination = CatalogueWorld::combination($this->a->organisation);

    $this->patchJson('/api/v1/catalogue/plan-vocabulary/combinations/'.$combination->getKey(), [
        'is_active' => false,
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.combination.is_active', false);

    // Still served by the index, with its flag. There being no delete, a
    // withdrawn row that vanished from the list would be withdrawn for good.
    $this->getJson('/api/v1/catalogue/plan-vocabulary/combinations', $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.is_active', false);
});

it('refuses to move a vocabulary code once it has been created', function (): void {
    $band = CatalogueWorld::energyBand($this->a->organisation);

    $this->patchJson('/api/v1/catalogue/plan-vocabulary/energy-bands/'.$band->getKey(), [
        'code' => 'renamed',
        'name_en' => 'Renamed',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(EnergyBand::withoutTenancy()->whereKey($band->getKey())->value('code'))->toBe('kcal-1200-1500');
});

it('needs no If-Match on a vocabulary row, because there is no lock version to carry', function (): void {
    $band = CatalogueWorld::energyBand($this->a->organisation);

    // No `precondition` middleware on these routes: sending a validator a
    // resource cannot honour would be worse than sending none.
    $this->patchJson('/api/v1/catalogue/plan-vocabulary/energy-bands/'.$band->getKey(), [
        'name_en' => '1200 to 1500 kcal',
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.energy_band.name_en', '1200 to 1500 kcal');
});

it('refuses an energy band whose ends meet or cross', function (): void {
    $this->postJson('/api/v1/catalogue/plan-vocabulary/energy-bands', [
        'code' => 'flat',
        'name_en' => 'Flat',
        'min_kcal' => 1500,
        'max_kcal' => 1500,
    ], $this->headers)->assertStatus(422);

    $band = CatalogueWorld::energyBand($this->a->organisation);

    // And on the PATCH path, where only one end is submitted and the
    // comparison has to run against the merged row.
    $this->patchJson('/api/v1/catalogue/plan-vocabulary/energy-bands/'.$band->getKey(), [
        'min_kcal' => 1600,
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['max_kcal']]]]);
});

it('stores a one-off duration with no number of days at all', function (): void {
    $this->postJson('/api/v1/catalogue/plan-vocabulary/durations', [
        'code' => 'one-off',
        'duration_kind' => 'one_off',
        'name_en' => 'One-off order',
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.duration.duration_kind', 'one_off')
        // Null, not zero. The sentinel is gone from the wire as well as from
        // the column, which is the whole point of §4.3.
        ->assertJsonPath('data.duration.duration_days', null);

    expect(PlanDuration::withoutTenancy()->where('code', 'one-off')->value('duration_days'))->toBeNull();
});

it('keeps every fixed run the source data has', function (string $days): void {
    $this->postJson('/api/v1/catalogue/plan-vocabulary/durations', [
        'code' => 'days-'.$days,
        'duration_kind' => 'fixed_days',
        'duration_days' => (int) $days,
        'name_en' => $days.' days',
    ], $this->headers)
        ->assertStatus(201)
        ->assertJsonPath('data.duration.duration_days', (int) $days);
})->with(['5', '20', '40', '60']);

it('refuses a one-off that carries a length', function (): void {
    $this->postJson('/api/v1/catalogue/plan-vocabulary/durations', [
        'code' => 'contradiction',
        'duration_kind' => 'one_off',
        'duration_days' => 20,
        'name_en' => 'Contradiction',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed')
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['duration_days']]]]);
});

it('refuses a fixed run with no length, and says why zero is not one', function (): void {
    $this->postJson('/api/v1/catalogue/plan-vocabulary/durations', [
        'code' => 'lengthless',
        'duration_kind' => 'fixed_days',
        'name_en' => 'Lengthless',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['duration_days']]]]);

    // Zero is refused by the request layer with a message about the sentinel
    // rather than a range violation: a client sending it is following the old
    // convention and needs to be told that it is gone.
    $this->postJson('/api/v1/catalogue/plan-vocabulary/durations', [
        'code' => 'zero',
        'duration_kind' => 'fixed_days',
        'duration_days' => 0,
        'name_en' => 'Zero',
    ], $this->headers)
        ->assertStatus(422)
        ->assertJsonStructure(['error' => ['details' => ['fields' => ['duration_days']]]]);
});

it('lets a PATCH turn a fixed run into a one-off only by clearing the length', function (): void {
    $duration = CatalogueWorld::duration($this->a->organisation);

    $this->patchJson('/api/v1/catalogue/plan-vocabulary/durations/'.$duration->getKey(), [
        'duration_kind' => 'one_off',
    ], $this->headers)->assertStatus(422);

    $this->patchJson('/api/v1/catalogue/plan-vocabulary/durations/'.$duration->getKey(), [
        'duration_kind' => 'one_off',
        'duration_days' => null,
    ], $this->headers)
        ->assertOk()
        ->assertJsonPath('data.duration.duration_kind', 'one_off')
        ->assertJsonPath('data.duration.duration_days', null);
});

it('refuses the sentinel at the database as well, whatever writes the row', function (): void {
    // The API refusals above are what explain the rule; this is what makes it
    // true of an importer, a console session and a backfill. A savepoint, so
    // the refusal does not abort the transaction the test runs inside.
    $insert = fn (string $kind, ?int $days) => DB::transaction(fn () => PlanDuration::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'code' => 'raw-'.$kind.'-'.($days ?? 'null'),
        'duration_kind' => $kind,
        'duration_days' => $days,
        'name_en' => 'Raw',
        'name_ar' => 'خام',
    ]));

    expect(fn () => $insert('fixed_days', 0))->toThrow(QueryException::class)
        ->and(fn () => $insert('one_off', 20))->toThrow(QueryException::class)
        ->and(fn () => $insert('fixed_days', null))->toThrow(QueryException::class);

    // And the two legitimate shapes still go in.
    $insert('fixed_days', 20);
    $insert('one_off', null);

    expect(PlanDuration::withoutTenancy()->where('code', 'like', 'raw-%')->count())->toBe(2);
});

it('lists durations with the one-off first, because it is the shortest commitment there is', function (): void {
    CatalogueWorld::duration($this->a->organisation, 'days-40', 40);
    CatalogueWorld::duration($this->a->organisation, 'one-off', null);
    CatalogueWorld::duration($this->a->organisation, 'days-20', 20);

    $codes = $this->getJson('/api/v1/catalogue/plan-vocabulary/durations', $this->headers)
        ->assertOk()
        ->json('data.*.code');

    expect($codes)->toBe(['one-off', 'days-20', 'days-40']);
});

it('refuses to delete a vocabulary row a plan configuration still points at', function (): void {
    // The `restrictOnDelete` backstop behind "deactivate, never delete". The
    // API offers no destroy path at all; this proves the rule survives one.
    $plan = CatalogueWorld::plan($this->a);
    $combination = CatalogueWorld::combination($this->a->organisation);
    $duration = CatalogueWorld::duration($this->a->organisation);

    $this->putJson('/api/v1/catalogue/plans/'.$plan->getKey().'/variants', [
        'cells' => [[
            'meal_combination_option_id' => (string) $combination->getKey(),
            'meals_per_day' => 2,
        ]],
    ], $this->headers + ['If-Match' => '"0"'])->assertOk();

    $variantId = (string) CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $plan->getKey())->sole()->getKey();

    PlanVariantDuration::withoutTenancy()->create([
        'organisation_id' => $this->a->organisation->getKey(),
        'catalogue_item_variant_id' => $variantId,
        'plan_duration_id' => $duration->getKey(),
        'is_available' => true,
    ]);

    $deleteCombination = fn () => DB::transaction(fn () => MealCombinationOption::withoutTenancy()->whereKey($combination->getKey())->delete());
    $deleteDuration = fn () => DB::transaction(fn () => PlanDuration::withoutTenancy()->whereKey($duration->getKey())->delete());

    expect($deleteCombination)->toThrow(QueryException::class)
        ->and($deleteDuration)->toThrow(QueryException::class);
});

it('keeps one kitchens vocabulary out of anothers', function (): void {
    CatalogueWorld::combination($this->a->organisation, 'mine');

    $b = CatalogueWorld::kitchen('isolated-planner@catalogue.test');
    CatalogueWorld::combination($b->organisation, 'theirs');

    $this->getJson('/api/v1/catalogue/plan-vocabulary/combinations', $this->headers)
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        ->assertJsonPath('data.0.code', 'mine');

    // And addressing another kitchen's row by identifier is a 404, not a
    // permission error: the row is not there to be seen.
    $theirs = MealCombinationOption::withoutTenancy()->where('code', 'theirs')->sole();

    $this->patchJson('/api/v1/catalogue/plan-vocabulary/combinations/'.$theirs->getKey(), ['name_en' => 'Hijacked'], $this->headers)
        ->assertStatus(404);
});

it('records vocabulary writes without a key the audit redactor would blank', function (): void {
    $this->postJson('/api/v1/catalogue/plan-vocabulary/durations', [
        'code' => 'days-20',
        'duration_kind' => 'fixed_days',
        'duration_days' => 20,
        'name_en' => '20 days',
    ], $this->headers)->assertStatus(201);

    $event = AuditLog::query()->where('action', 'catalogue.plan_vocabulary_updated')->sole();

    // The redactor matches `code` as a substring (OQ-036), so a `*_code` key
    // would arrive as "[redacted]" and the trail would be useless.
    expect($event->metadata['vocabulary'])->toBe('durations')
        ->and($event->metadata['entry'])->toBe('days-20')
        ->and($event->metadata['operation'])->toBe('created');

    foreach (array_keys($event->metadata) as $key) {
        expect(str_contains(strtolower((string) $key), 'code'))->toBeFalse();
    }
});

it('refuses the whole family to a caller without the plan permission', function (): void {
    $limited = CatalogueWorld::kitchen('nolplan@catalogue.test', ['catalogue.view_organisation', 'catalogue.manage_organisation']);

    forgetResolvedGuards();
    $this->actingAs($limited->user);

    $headers = CatalogueWorld::headers($limited);

    $this->getJson('/api/v1/catalogue/plan-vocabulary/combinations', $headers)
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');

    $this->postJson('/api/v1/catalogue/plan-vocabulary/durations', [
        'code' => 'days-20',
        'duration_kind' => 'fixed_days',
        'duration_days' => 20,
        'name_en' => '20 days',
    ], $headers)->assertStatus(403);
});

it('reports the stored duration kind as an enum the application can branch on', function (): void {
    $duration = CatalogueWorld::duration($this->a->organisation, 'one-off', null);

    expect($duration->duration_kind)->toBe(PlanDurationKind::OneOff)
        ->and($duration->duration_kind->carriesDays())->toBeFalse()
        ->and(CatalogueWorld::duration($this->a->organisation, 'days-5', 5)->duration_kind->carriesDays())->toBeTrue();
});
