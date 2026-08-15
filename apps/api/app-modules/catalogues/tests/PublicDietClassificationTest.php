<?php

declare(strict_types=1);

use Healthy360\ReferenceData\Database\Seeders\ReferenceDataSeeder;
use Healthy360\ReferenceData\Models\DietClassification;

/*
|--------------------------------------------------------------------------
| The public diet vocabulary
|--------------------------------------------------------------------------
|
| Anonymous, localised, and carrying one name rather than two. The same three
| properties the public allergen-class list is pinned on, because the same
| projection rule (master plan v2 §4.8) governs both and a second endpoint
| that quietly serialised both columns would be the leak the rule exists to
| prevent.
|
*/

beforeEach(function (): void {
    $this->seed(ReferenceDataSeeder::class);
});

it('serves the vocabulary to an anonymous caller', function (): void {
    // A diet filter that only works after sign-in is not a diet filter.
    $response = $this->getJson('/api/v1/reference/diet-classifications')
        ->assertOk()
        ->assertJsonPath('meta.count', 12)
        ->assertJsonPath('meta.locale', 'en');

    expect(array_column($response->json('data'), 'code'))->toBe([
        'omnivore', 'vegetarian', 'vegan', 'pescatarian', 'keto', 'low_carb',
        'high_protein', 'mediterranean', 'halal_friendly', 'gluten_free',
        'dairy_free', 'nut_free',
    ]);
});

it('carries one server-localised name and never both columns', function (): void {
    $english = $this->getJson('/api/v1/reference/diet-classifications')->assertOk()->json('data.1');
    $arabic = $this->getJson('/api/v1/reference/diet-classifications', ['Accept-Language' => 'ar-LB,ar;q=0.9'])
        ->assertOk()
        ->assertJsonPath('meta.locale', 'ar')
        ->json('data.1');

    expect($english['name'])->toBe('Vegetarian')
        ->and($arabic['name'])->toBe('نباتي')
        ->and(array_keys($english))->toBe(['code', 'name', 'display_order'])
        ->and($english)->not->toHaveKey('name_en')
        ->and($english)->not->toHaveKey('name_ar');
});

it('hides a withdrawn classification from the public list', function (): void {
    DietClassification::query()->where('code', 'keto')->update(['is_active' => false]);

    $codes = array_column($this->getJson('/api/v1/reference/diet-classifications')->assertOk()->json('data'), 'code');

    expect($codes)->not->toContain('keto')->and($codes)->toHaveCount(11);
});

it('falls back to English for a language the platform does not publish', function (): void {
    $this->getJson('/api/v1/reference/diet-classifications', ['Accept-Language' => 'fr-FR,fr;q=0.9'])
        ->assertOk()
        ->assertJsonPath('meta.locale', 'en');
});
