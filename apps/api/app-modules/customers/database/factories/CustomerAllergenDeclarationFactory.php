<?php

declare(strict_types=1);

namespace Healthy360\Customers\Database\Factories;

use Healthy360\Allergens\Models\Allergen;
use Healthy360\Customers\Enums\AllergenSeverity;
use Healthy360\Customers\Models\CustomerAllergenDeclaration;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CustomerAllergenDeclaration>
 */
class CustomerAllergenDeclarationFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'customer_dietary_profile_id' => CustomerDietaryProfile::factory()->declared(),
            'allergen_code' => fn (): string => (string) Allergen::query()->value('code'),
            'severity' => AllergenSeverity::Allergy,
            'declared_at' => now(),
        ];
    }

    public function severity(AllergenSeverity $severity): static
    {
        return $this->state(fn (): array => ['severity' => $severity]);
    }
}
