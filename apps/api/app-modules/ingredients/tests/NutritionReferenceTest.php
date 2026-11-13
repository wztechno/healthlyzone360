<?php

declare(strict_types=1);

use Healthy360\Ingredients\Nutrition\NutritionReferenceService;
use Healthy360\Ingredients\Nutrition\ProviderUnavailable;
use Healthy360\Ingredients\Nutrition\ReferenceUnsuitable;
use Healthy360\Ingredients\Nutrition\UsdaFoodDataProvider;
use Healthy360\Ingredients\Services\IngredientMutationLock;
use Healthy360\Recipes\Services\RecipeNutritionService;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Support\NutritionReferenceFixture;

beforeEach(function (): void {
    Cache::flush();
    Http::preventStrayRequests();
});

it('maps complete cooked food without inventing nutrients and preserves an explicit zero', function (): void {
    $food = NutritionReferenceFixture::food();
    $mapped = app(NutritionReferenceService::class)->map(['food' => $food, 'retrieved_at' => '2026-01-01T00:00:00Z']);
    expect($mapped->candidate['suitable'])->toBeTrue()
        ->and($mapped->candidate['nutrition_per_100g']['amounts'][4]['value'])->toBe(0.0)
        ->and($mapped->candidate['nutrition_per_100g']['amounts'][6]['unit'])->toBe('mg');
    array_pop($food['foodNutrients']);
    $mapped = app(NutritionReferenceService::class)->map(['food' => $food, 'retrieved_at' => '2026-01-01T00:00:00Z']);
    expect($mapped->candidate['suitable'])->toBeFalse()->and($mapped->candidate['missing_nutrients'])->toContain('sodium');
});

it('supports Atwater and decimal number fallbacks and rejects wrong units and volume bases', function (): void {
    $food = NutritionReferenceFixture::food();
    $food['foodNutrients'][0]['nutrient']['number'] = '958.0';
    $food['foodNutrients'][5]['nutrient']['number'] = '269.3';
    $service = app(NutritionReferenceService::class);
    expect($service->map(['food' => $food, 'retrieved_at' => 'now'])->candidate['suitable'])->toBeTrue();
    $food['foodNutrients'][6]['nutrient']['unitName'] = 'g';
    expect($service->map(['food' => $food, 'retrieved_at' => 'now'])->candidate['suitable'])->toBeFalse();
    $food = NutritionReferenceFixture::food();
    $food['dataType'] = 'Branded';
    $food['servingSizeUnit'] = 'ml';
    $perMillilitre = $service->map(['food' => $food, 'retrieved_at' => 'now'])->candidate;
    expect($perMillilitre['suitable'])->toBeFalse()
        ->and($perMillilitre['unsupported_basis'])->toBeTrue()
        ->and($perMillilitre['missing_nutrients'])->toBe([]);
    $food['servingSizeUnit'] = 'g';
    $perGram = $service->map(['food' => $food, 'retrieved_at' => 'now'])->candidate;
    expect($perGram['suitable'])->toBeTrue()->and($perGram['unsupported_basis'])->toBeFalse();
});

it('hydrates search in bulk and retains cached retrieval timestamps', function (): void {
    NutritionReferenceFixture::selection();
    $service = app(NutritionReferenceService::class);
    $results = $service->search('chicken');
    expect($results)->toHaveCount(1);
    $timestamp = $results[0]['retrieved_at'];
    $this->travel(1)->days();
    $record = app(UsdaFoodDataProvider::class)->fetch('12345');
    expect($record['retrieved_at'])->toBe($timestamp);
    Http::assertSentCount(2);
});

it('accepts all supported mass-based types while saturated fat remains optional', function (string $type): void {
    $food = NutritionReferenceFixture::food();
    $food['dataType'] = $type;
    $food['servingSizeUnit'] = 'g';
    $food['brandName'] = '';
    $food['brandOwner'] = 'Example supplier';
    $food['foodNutrients'][0]['nutrient']['number'] = '957';
    $mapped = app(NutritionReferenceService::class)->map(['food' => $food, 'retrieved_at' => 'now']);
    expect($mapped->candidate['suitable'])->toBeTrue()
        ->and($mapped->candidate['brand'])->toBe('Example supplier')
        ->and(array_column($mapped->candidate['nutrition_per_100g']['amounts'], 'nutrient_id'))->not->toContain('saturated_fat');
})->with(['Foundation', 'SR Legacy', 'Branded']);

it('distinguishes an unknown reference, a rejected key and a successful empty search', function (): void {
    config(['services.usda_fdc.key' => 'test-key']);
    Http::fakeSequence()->push([], 404)->push([], 403)->push(['foods' => []]);
    $provider = app(UsdaFoodDataProvider::class);
    expect(fn () => $provider->fetch('404'))->toThrow(ReferenceUnsuitable::class);
    try {
        $provider->fetch('403');
        $this->fail('Expected rejected-key error');
    } catch (ProviderUnavailable $error) {
        expect($error->errorCode->value)->toBe('nutrition.provider_configuration');
    }
    expect($provider->search('no matches'))->toBe([]);
    expect($provider->search('no matches'))->toBe([]);
    Http::assertSentCount(3);
});

it('counts a successful retry as a separate attempt in the shared budget', function (): void {
    config(['services.usda_fdc.key' => 'test-key', 'services.usda_fdc.budget' => 2]);
    Http::fakeSequence()->push([], 503)->push(NutritionReferenceFixture::food());
    $provider = app(UsdaFoodDataProvider::class);
    expect($provider->fetch('12345')['food']['fdcId'])->toBe(12345);
    expect(fn () => $provider->fetch('another', fresh: true))->toThrow(ReferenceUnsuitable::class);
    expect(fn () => $provider->fetch('67890', fresh: true))->toThrow(ProviderUnavailable::class);
    Http::assertSentCount(2);
});

it('refreshes cached search previews when a fresh detail fetch changes the source', function (): void {
    config(['services.usda_fdc.key' => 'test-key']);
    $food = NutritionReferenceFixture::food();
    Http::fake(function (Request $request) use (&$food) {
        if (str_ends_with($request->url(), '/foods/search')) {
            return Http::response(['foods' => [['fdcId' => 12345]]]);
        }

        return Http::response(str_ends_with($request->url(), '/foods') ? [$food] : $food);
    });
    $service = app(NutritionReferenceService::class);
    $before = $service->search('chicken')[0];
    $food['description'] = 'A changed purchased preparation';
    app(UsdaFoodDataProvider::class)->fetch('12345', fresh: true);
    $after = $service->search('chicken')[0];
    expect($after['source_hash'])->not->toBe($before['source_hash'])
        ->and($after['label'])->toBe($food['description']);
    Http::assertSentCount(3);
});

it('requires acknowledgement and rejects changed source hashes', function (): void {
    $selection = NutritionReferenceFixture::selection();
    $service = app(NutritionReferenceService::class);
    expect(fn () => $service->resolve('usda:12345', $selection['nutrition_reference_hash'], false))->toThrow(ReferenceUnsuitable::class);
    expect(fn () => $service->resolve('usda:12345', str_repeat('0', 64), true))->toThrow(ApiException::class);
});

it('counts retries against the quota and distinguishes configuration errors', function (): void {
    config(['services.usda_fdc.key' => 'test', 'services.usda_fdc.budget' => 1]);
    Http::fake(['*' => Http::response([], 500)]);
    expect(fn () => app(UsdaFoodDataProvider::class)->fetch('123'))->toThrow(ProviderUnavailable::class);
    Http::assertSentCount(1);
    config(['services.usda_fdc.key' => '']);
    try {
        app(UsdaFoodDataProvider::class)->fetch('124');
        $this->fail('Expected configuration error');
    } catch (ProviderUnavailable $error) {
        expect($error->errorCode->value)->toBe('nutrition.provider_configuration')->and($error->details['retryable'])->toBeFalse();
    }
});

it('honours the cooldown without converting an outage into an empty search', function (): void {
    config(['services.usda_fdc.key' => 'test']);
    Http::fake(['*' => Http::response([], 429, ['Retry-After' => '120'])]);
    $provider = app(UsdaFoodDataProvider::class);
    expect(fn () => $provider->search('unknown'))->toThrow(ProviderUnavailable::class);
    expect(fn () => $provider->search('other'))->toThrow(ProviderUnavailable::class);
    Http::assertSentCount(1);
});

it('does not shorten a cooldown set by another in-flight response', function (): void {
    config(['services.usda_fdc.key' => 'test-key']);
    $until = (int) now()->timestamp + 300;
    Http::fake(function () use ($until) {
        Cache::put('nutrition:usda:cooldown', $until, 300);

        return Http::response([], 429, ['Retry-After' => '120']);
    });
    expect(fn () => app(UsdaFoodDataProvider::class)->fetch('12345'))->toThrow(ProviderUnavailable::class);
    expect(Cache::get('nutrition:usda:cooldown'))->toBe($until);
    Http::assertSentCount(1);
});

it('keeps required nutrients aligned with the recipe rollup contract', function (): void {
    $reflection = new ReflectionClass(RecipeNutritionService::class);
    expect(NutritionReferenceService::REQUIRED_NUTRIENTS)->toBe(array_keys($reflection->getConstant('REQUIRED_NUTRIENTS')));
});

it('serializes mutations on the same ingredient across database sessions', function (): void {
    $id = (string) Str::uuid7();
    IngredientMutationLock::acquire($id);
    config(['database.connections.nutrition_lock_test' => config('database.connections.pgsql')]);
    $other = DB::connection('nutrition_lock_test');
    try {
        $other->beginTransaction();
        $result = $other->selectOne('select pg_try_advisory_xact_lock(hashtextextended(?, 0)) as acquired', ['ingredient-allergens:'.$id]);
        expect($result->acquired)->toBeFalse();
    } finally {
        $other->rollBack();
        DB::purge('nutrition_lock_test');
    }
});

it('does not change the source hash when upstream nutrient order changes', function (): void {
    $food = NutritionReferenceFixture::food();
    $service = app(NutritionReferenceService::class);
    $first = $service->map(['food' => $food, 'retrieved_at' => '2026-01-01T00:00:00Z']);
    $food['foodNutrients'] = array_reverse($food['foodNutrients']);
    $second = $service->map(['food' => $food, 'retrieved_at' => '2026-02-01T00:00:00Z']);
    expect($second->candidate['source_hash'])->toBe($first->candidate['source_hash']);
});
