<?php

declare(strict_types=1);

namespace Healthy360\Allergens\Database\Factories;

use Healthy360\Allergens\Models\Allergen;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Allergen>
 */
class AllergenFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $index = fake()->unique()->numberBetween(1, 999);

        return [
            'code' => 'allergen_'.$index,
            'name_en' => 'Allergen '.$index,
            'name_ar' => 'مسبب حساسية '.$index,
            'description_en' => null,
            'description_ar' => null,
            'regulatory_ref' => 'ALG-'.str_pad((string) $index, 2, '0', STR_PAD_LEFT),
            'is_eu_14' => true,
            'is_us_big_9' => false,
            'us_declaration_required' => false,
            'us_threshold_ppm' => null,
            'display_order' => $index,
            'is_active' => true,
        ];
    }

    public function inactive(): static
    {
        return $this->state(fn (array $attributes): array => ['is_active' => false]);
    }
}
