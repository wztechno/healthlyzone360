<?php

declare(strict_types=1);

use Healthy360\Kitchens\Import\Parsers\MealPlanParser;
use Healthy360\Kitchens\Tests\Import\WorkbookFixture;

/*
|--------------------------------------------------------------------------
| Plans, combinations, and a pricing sheet with no prices in it
|--------------------------------------------------------------------------
|
| Two constraints drive most of these assertions. `meals_per_day` must be
| positive, because a plan that delivers nothing is not a plan; and there must
| never be a zero-day duration, because "No subscription | 0" is a one-off
| purchase rather than a subscription that lasts no time. Both are database
| CHECK constraints, so a parser that produced either would not write a bad
| row — it would fail the import, at the point where the operator can no
| longer see which sheet caused it.
|
*/

beforeEach(function (): void {
    $this->parsed = MealPlanParser::parse(WorkbookFixture::read(WorkbookFixture::MEAL_PLANS));
    $this->findings = collect($this->parsed['findings']);
});

it('reads the plan catalogue with its types normalised and its wording kept', function (): void {
    expect($this->parsed['plans'])->toHaveCount(8)
        ->and($this->parsed['plans'][0])->toBe([
            'plan_id' => 'PLN-001',
            'name' => 'Fixture General Plan',
            'plan_type' => 'both',
            'plan_type_verbatim' => 'Both',
            'status' => 'Active',
            'notes' => null,
        ])
        ->and($this->parsed['plans'][5]['plan_type'])->toBe('limited_time')
        ->and($this->parsed['plans'][1]['plan_type'])->toBe('subscription');
});

it('keeps a plan name with a double space exactly as the source spells it', function (): void {
    expect($this->parsed['plans'][4]['name'])->toBe('Fixture Green  Plan')
        ->and($this->parsed['plans'][6]['name'])->toBe('Fixture Cleansing  Plan');
});

it('reads an unrecognised plan type as the widest one and says so', function (): void {
    expect($this->parsed['plans'][7])->toMatchArray([
        'plan_type' => 'both',
        'plan_type_verbatim' => 'Seasonal',
    ])->and($this->findings->firstWhere('code', 'plan_type_unmapped')['detail'])->toContain('"Seasonal"');
});

/*
|--------------------------------------------------------------------------
| The nine combinations
|--------------------------------------------------------------------------
*/

it('unions the two sheets into exactly nine combinations, in a canonical order', function (): void {
    expect(array_column($this->parsed['combinations'], 'code'))->toBe([
        'free-selection',
        'breakfast',
        'lunch',
        'dinner',
        'snack',
        'breakfast-lunch',
        'breakfast-dinner',
        'lunch-dinner',
        'full-day',
    ]);
});

it('never records a combination that delivers nothing', function (): void {
    foreach ($this->parsed['combinations'] as $combination) {
        expect($combination['meals_per_day'])->toBeGreaterThan(0);
    }
});

it('describes a snack honestly: one item, and not one of the three meals', function (): void {
    expect(collect($this->parsed['combinations'])->firstWhere('code', 'snack'))->toBe([
        'code' => 'snack',
        'name' => 'Snack',
        'includes_breakfast' => false,
        'includes_lunch' => false,
        'includes_dinner' => false,
        'meals_per_day' => 1,
        'is_free_selection' => false,
    ]);
});

it('counts a pair as two meals and a full day as three', function (): void {
    expect(collect($this->parsed['combinations'])->firstWhere('code', 'breakfast-dinner'))->toMatchArray([
        'includes_breakfast' => true,
        'includes_lunch' => false,
        'includes_dinner' => true,
        'meals_per_day' => 2,
    ])->and(collect($this->parsed['combinations'])->firstWhere('code', 'full-day'))->toMatchArray([
        'includes_breakfast' => true,
        'includes_lunch' => true,
        'includes_dinner' => true,
        'meals_per_day' => 3,
    ]);
});

it('flags the one number the source does not state', function (): void {
    expect(collect($this->parsed['combinations'])->firstWhere('code', 'free-selection'))->toMatchArray([
        'meals_per_day' => 1,
        'is_free_selection' => true,
    ])->and($this->findings->firstWhere('code', 'free_selection_meals_per_day_assumed')['detail'])
        ->toContain('an assumption');
});

/*
|--------------------------------------------------------------------------
| Bands, durations and the twelve columns
|--------------------------------------------------------------------------
*/

it('reads the calorie bands', function (): void {
    expect($this->parsed['energy_bands'])->toHaveCount(6)
        ->and($this->parsed['energy_bands'][0])->toBe(['code' => '800-1000', 'name' => '800 - 1000', 'min_kcal' => 800, 'max_kcal' => 1000])
        ->and($this->parsed['energy_bands'][5])->toBe(['code' => '2050-2200', 'name' => '2050 - 2200', 'min_kcal' => 2050, 'max_kcal' => 2200]);
});

it('turns "No subscription | 0" into a one-off rather than a zero-day subscription', function (): void {
    expect($this->parsed['durations'])->toBe([
        ['code' => 'one-off', 'name' => 'No subscription', 'kind' => 'one_off', 'days' => null],
        ['code' => '5-days', 'name' => '5 days', 'kind' => 'fixed_days', 'days' => 5],
        ['code' => '20-days', 'name' => '20 days', 'kind' => 'fixed_days', 'days' => 20],
        ['code' => '40-days', 'name' => '40 days', 'kind' => 'fixed_days', 'days' => 40],
        ['code' => '60-days', 'name' => '60 days', 'kind' => 'fixed_days', 'days' => 60],
    ]);

    foreach ($this->parsed['durations'] as $duration) {
        expect($duration['days'])->not->toBe(0);
    }
});

it('reads all twelve matrix columns with their tier and their snack', function (): void {
    expect($this->parsed['variant_columns'])->toHaveCount(12)
        ->and($this->parsed['variant_columns'][0])->toBe([
            'column' => 'Breakfast',
            'combination_code' => 'breakfast',
            'tier' => 'standard',
            'includes_snacks' => false,
            'meals_per_day' => 1,
            'snacks_per_day' => 0,
        ])
        ->and($this->parsed['variant_columns'][3])->toBe([
            'column' => 'Snack',
            'combination_code' => 'snack',
            'tier' => 'standard',
            'includes_snacks' => true,
            'meals_per_day' => 1,
            'snacks_per_day' => 1,
        ])
        ->and($this->parsed['variant_columns'][5])->toBe([
            'column' => 'Breakfast + Lunch (Premium)',
            'combination_code' => 'breakfast-lunch',
            'tier' => 'premium',
            'includes_snacks' => true,
            'meals_per_day' => 2,
            'snacks_per_day' => 1,
        ])
        ->and($this->parsed['variant_columns'][11])->toBe([
            'column' => 'Full Day (Premium)',
            'combination_code' => 'full-day',
            'tier' => 'premium',
            'includes_snacks' => true,
            'meals_per_day' => 3,
            'snacks_per_day' => 1,
        ]);
});

/*
|--------------------------------------------------------------------------
| The availability matrix
|--------------------------------------------------------------------------
*/

it('records a cell for every plan and every column, whether or not it is offered', function (): void {
    expect($this->parsed['variant_matrix'])->toHaveCount(8 * 12);
});

it('reads only Y as offered, and a blank as not offered', function (): void {
    $available = collect($this->parsed['variant_matrix'])
        ->where('plan_name', 'Fixture Desk Lunch')
        ->where('available', true)
        ->pluck('column')
        ->all();

    expect($available)->toBe(['Lunch', 'Snack']);
});

it('matches a matrix row to its plan on the collapsed name and reports that it had to', function (): void {
    $cleansing = collect($this->parsed['variant_matrix'])->where('plan_name', 'Fixture Cleansing  Plan');

    // The matrix spells it with one space; the plan list with two. The
    // canonical spelling wins in the output.
    expect($cleansing)->toHaveCount(12);

    $findings = $this->findings->where('code', 'plan_name_whitespace')->pluck('detail');

    expect($findings->filter(fn (string $d): bool => str_contains($d, 'The availability matrix spells this plan')))->not->toBeEmpty()
        ->and($findings->filter(fn (string $d): bool => str_contains($d, 'carries repeated whitespace')))->not->toBeEmpty();
});

it('keeps a matrix row that matches no plan rather than dropping it', function (): void {
    expect(collect($this->parsed['variant_matrix'])->where('plan_name', 'Fixture Retired Plan'))->toHaveCount(12)
        ->and($this->findings->firstWhere('code', 'plan_row_unmatched')['detail'])->toContain('"Fixture Retired Plan"');
});

/*
|--------------------------------------------------------------------------
| The two refusals
|--------------------------------------------------------------------------
*/

it('counts the example meal map and refuses to import it', function (): void {
    expect($this->parsed['meal_map'])->toMatchArray(['imported' => false, 'row_count' => 4])
        ->and($this->parsed['meal_map']['reason'])->toContain('EXAMPLE')
        ->and($this->findings->firstWhere('code', 'meal_map_not_imported')['detail'])->toContain('4 rows');
});

it('says out loud that the pricing sheet holds no prices', function (): void {
    expect($this->findings->firstWhere('code', 'plan_prices_absent')['detail'])
        ->toContain('availability flags and no amounts');
});

it('fires every finding code the fixture meal plan is built to provoke', function (): void {
    expect($this->findings->pluck('code')->unique()->sort()->values()->all())->toBe([
        'free_selection_meals_per_day_assumed',
        'meal_map_not_imported',
        'plan_name_whitespace',
        'plan_prices_absent',
        'plan_row_unmatched',
        'plan_type_unmapped',
    ]);
});
