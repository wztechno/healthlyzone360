<?php

declare(strict_types=1);

use Healthy360\AccessControl\Database\Seeders\AccessControlSeeder;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Catalogues\Enums\VariantStatus;
use Healthy360\Catalogues\Enums\VariantType;
use Healthy360\Catalogues\Models\CatalogueItem;
use Healthy360\Catalogues\Models\CatalogueItemVariant;
use Healthy360\Catalogues\Models\PlanVariantDuration;
use Healthy360\Catalogues\Models\PlanVariantProfile;
use Healthy360\Catalogues\Tests\Fixtures\CatalogueWorld;
use Healthy360\Organisations\Database\Seeders\OrganisationTypeSeeder;
use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;

/*
|--------------------------------------------------------------------------
| The plan profile, the configuration matrix and its durations
|--------------------------------------------------------------------------
|
| The matrix is the composite this slice exists for: a client submits *cells*
| and the server writes a `catalogue_item_variants` row plus a
| `plan_variant_profiles` row for each, atomically, so that the thing a customer
| picks and the thing a price points at are one object.
|
| Three rules get the most attention, because each is a place the design could
| quietly go wrong:
|
|   - identity by derived code, so the same cell resubmitted keeps the variant a
|     price already names;
|   - absent cells archived rather than deleted, so a price row is never left
|     dangling;
|   - one cell, one configuration, including when the occupant is archived.
|
*/

beforeEach(function (): void {
    $this->seed([ReferenceDataSeeder::class, OrganisationTypeSeeder::class, AccessControlSeeder::class]);

    $this->a = CatalogueWorld::kitchen('matrix@catalogue.test');
    $this->headers = CatalogueWorld::headers($this->a);

    $this->plan = CatalogueWorld::plan($this->a);
    $this->lunchDinner = CatalogueWorld::combination($this->a->organisation, 'lunch-dinner');
    $this->fullDay = CatalogueWorld::combination($this->a->organisation, 'full-day');
    $this->lowerBand = CatalogueWorld::energyBand($this->a->organisation, 'kcal-1200-1500');

    $this->actingAs($this->a->user);

    $this->cells = fn (array $cells, string $lockVersion) => $this->putJson(
        '/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants',
        ['cells' => $cells],
        $this->headers + ['If-Match' => '"'.$lockVersion.'"'],
    );
});

it('writes the commercial terms of a plan, defaulting the cut-off to twenty-four hours', function (): void {
    // Nobody has written terms yet, and the surface says so rather than
    // inventing a set: "no decision has been made" is exactly what the publish
    // gate refuses.
    $this->getJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/profile', $this->headers)
        ->assertOk()
        ->assertJsonPath('data.profile', null)
        ->assertHeader('ETag', '"0"');

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/profile', [], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        // The 24 h rule both source systems state, preserved as the default.
        ->assertJsonPath('data.profile.change_cutoff_hours', 24)
        ->assertJsonPath('data.profile.plan_type', 'both')
        ->assertJsonPath('data.profile.pricing_basis', 'per_day')
        ->assertJsonPath('data.profile.skip_allowed', true)
        ->assertJsonPath('data.profile.pause_allowed', true)
        ->assertHeader('ETag', '"1"');

    expect(AuditLog::query()->where('action', 'catalogue.plan_profile_updated')->count())->toBe(1);
});

it('accepts a zero-hour cut-off, because until the van leaves is a real policy', function (): void {
    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/profile', [
        'change_cutoff_hours' => 0,
        'plan_type' => 'subscription',
        'pricing_basis' => 'total',
        'pause_allowed' => false,
    ], $this->headers + ['If-Match' => '"0"'])
        ->assertOk()
        ->assertJsonPath('data.profile.change_cutoff_hours', 0)
        ->assertJsonPath('data.profile.plan_type', 'subscription')
        ->assertJsonPath('data.profile.pricing_basis', 'total')
        ->assertJsonPath('data.profile.pause_allowed', false);
});

it('lets a catalogue reader see a plans terms but not its discounts', function (): void {
    // The one plan read that is not commercial. A plan's terms are what a
    // customer will be shown on the plan page and what a chef produces
    // against; the discounts are the commercial part, and they stay behind
    // `plan.manage_organisation`.
    $reader = CatalogueWorld::kitchen('reader@matrix.test', ['catalogue.view_organisation']);
    $plan = CatalogueWorld::plan($reader);

    forgetResolvedGuards();
    $this->actingAs($reader->user);

    $headers = CatalogueWorld::headers($reader);

    $this->getJson('/api/v1/catalogue/plans/'.$plan->getKey().'/profile', $headers)
        ->assertOk()
        ->assertJsonPath('data.profile', null);

    $this->getJson('/api/v1/catalogue/plans/'.$plan->getKey().'/variant-durations', $headers)
        ->assertStatus(403)
        ->assertJsonPath('error.code', 'authz.permission_denied');

    $this->putJson('/api/v1/catalogue/plans/'.$plan->getKey().'/profile', [], $headers + ['If-Match' => '"0"'])
        ->assertStatus(403);
});

it('refuses the whole plan family on an item that is not a subscription plan', function (): void {
    // A 422 rather than a 404: the caller can see this row perfectly well
    // through /catalogue/items/{item}, so a 404 would send them hunting for a
    // typo that is not there.
    $product = CatalogueWorld::publishableProduct($this->a);

    foreach (['profile', 'variants', 'variant-durations'] as $subResource) {
        $this->getJson('/api/v1/catalogue/plans/'.$product->getKey().'/'.$subResource, $this->headers)
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'validation.failed')
            ->assertJsonPath('error.details.item_type', 'product');
    }
});

it('derives a deterministic code for every cell from its own coordinates', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
        [
            'meal_combination_option_id' => (string) $this->fullDay->getKey(),
            'energy_band_id' => (string) $this->lowerBand->getKey(),
            'service_tier' => 'premium',
            'meals_per_day' => 3,
            'includes_snacks' => true,
            'snacks_per_day' => 1,
        ],
    ], '0')
        ->assertOk()
        ->assertJsonPath('meta.count', 2);

    $codes = CatalogueItemVariant::withoutTenancy()
        ->where('catalogue_item_id', $this->plan->getKey())
        ->pluck('code')
        ->all();

    expect($codes)->toEqualCanonicalizing([
        'lunch-dinner-standard',
        'full-day-premium-kcal-1200-1500',
    ]);

    // The pair is written together: a configuration with no profile row would
    // be a variant nobody can describe.
    expect(PlanVariantProfile::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->count())->toBe(2)
        ->and(CatalogueItemVariant::withoutTenancy()
            ->where('catalogue_item_id', $this->plan->getKey())
            ->where('variant_type', VariantType::PlanConfiguration->value)
            ->count())->toBe(2);
});

it('keeps the same variant when a cell is resubmitted, so a price keeps pointing at it', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    $original = CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->sole();

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 3, 'name_en' => 'Renamed'],
    ], '1')->assertOk();

    $reloaded = CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->sole();

    expect((string) $reloaded->getKey())->toBe((string) $original->getKey())
        ->and($reloaded->name_en)->toBe('Renamed')
        ->and(PlanVariantProfile::withoutTenancy()->whereKey($reloaded->getKey())->value('meals_per_day'))->toBe(3);
});

it('archives a cell the submission leaves out rather than deleting it', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
        ['meal_combination_option_id' => (string) $this->fullDay->getKey(), 'meals_per_day' => 3],
    ], '0')->assertOk();

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '1')
        ->assertOk()
        // The response carries every cell including the archived one, so a
        // client sees what the submission did rather than what it sent.
        ->assertJsonPath('meta.count', 2);

    $withdrawn = CatalogueItemVariant::withoutTenancy()->where('code', 'full-day-standard')->sole();

    expect($withdrawn->status)->toBe(VariantStatus::Archived)
        // The profile row survives: the cell stays occupied, because a price
        // may point at this variant and "we stopped selling it" is not "it
        // never existed".
        ->and(PlanVariantProfile::withoutTenancy()->whereKey($withdrawn->getKey())->exists())->toBeTrue();
});

it('revives an archived cell when it is submitted again', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    ($this->cells)([], '1')->assertOk();

    expect(CatalogueItemVariant::withoutTenancy()->where('code', 'lunch-dinner-standard')->value('status'))
        ->toBe(VariantStatus::Archived);

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '2')->assertOk();

    expect(CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->count())->toBe(1)
        ->and(CatalogueItemVariant::withoutTenancy()->where('code', 'lunch-dinner-standard')->value('status'))
        ->toBe(VariantStatus::Active);
});

it('refuses a submission that states one matrix cell twice', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'service_tier' => 'standard', 'meals_per_day' => 3],
    ], '0')
        ->assertStatus(422)
        ->assertJsonPath('error.code', 'validation.failed');

    expect(CatalogueItemVariant::withoutTenancy()->where('catalogue_item_id', $this->plan->getKey())->count())->toBe(0);
});

it('treats two cells that differ only by a missing band as one, not two', function (): void {
    // The `NULLS NOT DISTINCT` half of the uniqueness, at the service layer.
    // A kitchen that does not band by energy carries a NULL in every key, and
    // under default NULL semantics the same cell could be opened any number of
    // times.
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'energy_band_id' => null, 'meals_per_day' => 2, 'code' => 'other'],
    ], '0')->assertStatus(422);
});

it('refuses to open a second configuration at a cell an archived one still holds', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    ($this->cells)([], '1')->assertOk();

    // Same coordinates, different code. Refused with the occupant named, so a
    // kitchen is told to revive rather than left with a constraint violation.
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2, 'code' => 'fresh-start'],
    ], '2')
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict')
        ->assertJsonPath('error.details.existing_configuration', 'lunch-dinner-standard');
});

it('lets two cells swap coordinates in one submission', function (): void {
    // The write order exists for this: releasing every submitted cell before
    // writing any of them is what keeps a swap from tripping the unique index
    // halfway through.
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2, 'code' => 'alpha'],
        ['meal_combination_option_id' => (string) $this->fullDay->getKey(), 'meals_per_day' => 3, 'code' => 'beta'],
    ], '0')->assertOk();

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->fullDay->getKey(), 'meals_per_day' => 3, 'code' => 'alpha'],
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2, 'code' => 'beta'],
    ], '1')->assertOk();

    $alpha = CatalogueItemVariant::withoutTenancy()->where('code', 'alpha')->sole();

    expect(PlanVariantProfile::withoutTenancy()->whereKey($alpha->getKey())->value('meal_combination_option_id'))
        ->toBe((string) $this->fullDay->getKey());
});

it('refuses a configuration whose snack count contradicts its snack flag', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2, 'includes_snacks' => true, 'snacks_per_day' => 0],
    ], '0')->assertStatus(422);

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2, 'includes_snacks' => false, 'snacks_per_day' => 2],
    ], '0')->assertStatus(422);
});

it('will not build a new cell on a deactivated vocabulary row, but will keep an existing one', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    $this->patchJson('/api/v1/catalogue/plan-vocabulary/combinations/'.$this->lunchDinner->getKey(), ['is_active' => false], $this->headers)
        ->assertOk();

    // The existing cell survives a resubmission — deactivating a combination
    // means "stop offering this", not "lock every plan that used it out of
    // being edited".
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
        ['meal_combination_option_id' => (string) $this->fullDay->getKey(), 'meals_per_day' => 3],
    ], '1')->assertOk();

    // A brand-new cell on the withdrawn row is refused.
    $this->patchJson('/api/v1/catalogue/plan-vocabulary/combinations/'.$this->fullDay->getKey(), ['is_active' => false], $this->headers)
        ->assertOk();

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
        ['meal_combination_option_id' => (string) $this->fullDay->getKey(), 'meals_per_day' => 3],
        [
            'meal_combination_option_id' => (string) $this->fullDay->getKey(),
            'service_tier' => 'premium',
            'meals_per_day' => 3,
        ],
    ], '2')->assertStatus(422);
});

it('refuses a cell naming another kitchens vocabulary', function (): void {
    $b = CatalogueWorld::kitchen('other-matrix@catalogue.test');
    $theirs = CatalogueWorld::combination($b->organisation, 'theirs');

    ($this->cells)([
        ['meal_combination_option_id' => (string) $theirs->getKey(), 'meals_per_day' => 2],
    ], '0')->assertStatus(422);
});

it('requires the items validator on the matrix and refuses a stale one', function (): void {
    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variants', ['cells' => []], $this->headers)
        ->assertStatus(428)
        ->assertJsonPath('error.code', 'request.precondition_required');

    ($this->cells)([], '7')
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});

it('records the matrix replacement with counts and no leaked codes', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
        ['meal_combination_option_id' => (string) $this->fullDay->getKey(), 'meals_per_day' => 3],
    ], '0')->assertOk();

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '1')->assertOk();

    $events = AuditLog::query()->where('action', 'catalogue.plan_variants_replaced')->orderBy('created_at')->get();

    expect($events)->toHaveCount(2)
        ->and($events->last()->metadata['cell_count'])->toBe(1)
        ->and($events->last()->metadata['archived_count'])->toBe(1)
        ->and($events->first()->metadata['created_count'])->toBe(2);
});

it('keeps a NULL discount NULL all the way there and back', function (): void {
    // The field this whole design decision hangs on. An absent discount is
    // "nobody has stated one", which is commercially different from "there is
    // no discount" — and writing 0.00 for both would answer the question
    // permanently and silently.
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    $oneOff = CatalogueWorld::duration($this->a->organisation, 'one-off', null);
    $twenty = CatalogueWorld::duration($this->a->organisation, 'days-20', 20);

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variant-durations', [
        'assignments' => [
            ['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'one-off'],
            ['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-20', 'discount_percent' => 12.5],
        ],
    ], $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('meta.count', 2)
        ->assertJsonPath('meta.unstated_discount_count', 1);

    $rows = PlanVariantDuration::withoutTenancy()->get()->keyBy('plan_duration_id');

    expect($rows->get((string) $oneOff->getKey())->discount_percent)->toBeNull()
        ->and($rows->get((string) $twenty->getKey())->discount_percent)->toBe('12.50');

    $served = $this->getJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variant-durations', $this->headers)
        ->assertOk()
        ->json('data.assignments');

    $byDuration = collect($served)->keyBy('plan_duration_id');

    expect($byDuration->get((string) $oneOff->getKey())['discount_percent'])->toBeNull()
        ->and($byDuration->get((string) $twenty->getKey())['discount_percent'])->toBe('12.50');
});

it('distinguishes a stated zero discount from an unstated one', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    CatalogueWorld::duration($this->a->organisation, 'days-20', 20);

    $this->putJson('/api/v1/catalogue/plans/'.$this->plan->getKey().'/variant-durations', [
        'assignments' => [
            ['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-20', 'discount_percent' => 0],
        ],
    ], $this->headers + ['If-Match' => '"1"'])
        ->assertOk()
        ->assertJsonPath('data.assignments.0.discount_percent', '0.00')
        ->assertJsonPath('meta.unstated_discount_count', 0);
});

it('removes an assignment the submission leaves out, and keeps one switched off', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    CatalogueWorld::duration($this->a->organisation, 'days-20', 20);
    CatalogueWorld::duration($this->a->organisation, 'days-40', 40);

    $put = fn (array $assignments, string $lockVersion) => $this->putJson(
        '/api/v1/catalogue/plans/'.$this->plan->getKey().'/variant-durations',
        ['assignments' => $assignments],
        $this->headers + ['If-Match' => '"'.$lockVersion.'"'],
    );

    $put([
        ['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-20', 'discount_percent' => 5],
        ['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-40', 'discount_percent' => 10],
    ], '1')->assertOk();

    // Dropping the row removes it — an assignment carries nothing but itself,
    // so there is no price to strand.
    $put([
        ['variant_code' => 'lunch-dinner-standard', 'duration_code' => 'days-20', 'discount_percent' => 5, 'is_available' => false],
    ], '2')
        ->assertOk()
        ->assertJsonPath('meta.count', 1)
        // Switched off, not discarded: the negotiated discount survives "we
        // still run 20 days, just not this month".
        ->assertJsonPath('data.assignments.0.is_available', false)
        ->assertJsonPath('data.assignments.0.discount_percent', '5.00');
});

it('refuses an assignment naming a configuration of another plan', function (): void {
    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')->assertOk();

    $other = CatalogueWorld::plan($this->a, 'Other plan');
    CatalogueWorld::duration($this->a->organisation, 'days-20', 20);

    $mine = CatalogueItemVariant::withoutTenancy()->where('code', 'lunch-dinner-standard')->sole();

    $this->putJson('/api/v1/catalogue/plans/'.$other->getKey().'/variant-durations', [
        'assignments' => [
            ['catalogue_item_variant_id' => (string) $mine->getKey(), 'duration_code' => 'days-20'],
        ],
    ], $this->headers + ['If-Match' => '"0"'])->assertStatus(422);
});

it('refuses to touch the matrix of a retired plan', function (): void {
    CatalogueItem::withoutTenancy()->whereKey($this->plan->getKey())->update(['status' => 'retired']);

    ($this->cells)([
        ['meal_combination_option_id' => (string) $this->lunchDinner->getKey(), 'meals_per_day' => 2],
    ], '0')
        ->assertStatus(409)
        ->assertJsonPath('error.code', 'resource.conflict');
});
