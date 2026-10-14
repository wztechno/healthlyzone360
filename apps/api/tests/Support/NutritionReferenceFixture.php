<?php

declare(strict_types=1);

namespace Tests\Support;

use Healthy360\Ingredients\Nutrition\NutritionReferenceService;
use Healthy360\Ingredients\Services\PackagingBranch;
use Illuminate\Support\Facades\Http;

final class NutritionReferenceFixture
{
    /** @return array<string, mixed> */
    public static function food(int $id = 12345): array
    {
        $nutrients = [['208', 'kcal', 100], ['203', 'g', 10], ['205', 'g', 12], ['204', 'g', 2], ['291', 'g', 0], ['269', 'g', 3], ['307', 'mg', 10600]];

        return ['fdcId' => $id, 'description' => 'Purchased cooked food', 'dataType' => 'SR Legacy', 'publicationDate' => '2026-01-01', 'foodNutrients' => array_map(static fn (array $entry): array => ['nutrient' => ['number' => $entry[0], 'unitName' => $entry[1]], 'amount' => $entry[2]], $nutrients)];
    }

    /** @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public static function foodPayload(array $payload): array
    {
        $category = $payload['ingredient_category_id'] ?? null;
        if (in_array($category, app(PackagingBranch::class)->categoryIds(), true)) {
            return $payload;
        }

        return $payload + self::selection();
    }

    /** @param array<string, mixed>|null $nutrition
     * @return array{nutrition_reference: string, nutrition_reference_hash: string, nutrition_reference_confirmed: bool}
     */
    public static function selection(?array $nutrition = null): array
    {
        config(['services.usda_fdc.key' => 'test-key']);
        $food = self::food();
        if ($nutrition !== null) {
            $values = array_column($nutrition['amounts'], 'value', 'nutrient_id');
            foreach (['energy', 'protein', 'carbohydrate', 'fat', 'fibre', 'sugars', 'sodium'] as $index => $name) {
                $food['foodNutrients'][$index]['amount'] = $values[$name];
            }
        }
        Http::fake([
            'api.nal.usda.gov/fdc/v1/foods/search' => Http::response(['foods' => [['fdcId' => 12345]]]),
            'api.nal.usda.gov/fdc/v1/foods' => Http::response([$food]),
            'api.nal.usda.gov/fdc/v1/food/*' => Http::response($food),
        ]);
        $mapped = app(NutritionReferenceService::class)->map(['food' => $food, 'retrieved_at' => '2026-01-01T00:00:00Z']);

        return ['nutrition_reference' => 'usda:12345', 'nutrition_reference_hash' => $mapped->candidate['source_hash'], 'nutrition_reference_confirmed' => true];
    }
}
