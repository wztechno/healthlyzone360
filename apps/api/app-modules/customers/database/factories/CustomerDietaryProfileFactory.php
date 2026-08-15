<?php

declare(strict_types=1);

namespace Healthy360\Customers\Database\Factories;

use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Customers\Models\CustomerDietaryProfile;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<CustomerDietaryProfile>
 */
class CustomerDietaryProfileFactory extends Factory
{
    /**
     * Undeclared by default. The unanswered state is the one most tests need
     * to start from — it is what a new account has — and making it the default
     * keeps "declared" an explicit act in the test as it is in the product.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'customer_account_id' => CustomerAccount::factory(),
            'declared_at' => null,
            'declares_no_allergens' => false,
        ];
    }

    public function declared(): static
    {
        return $this->state(fn (): array => ['declared_at' => now()]);
    }

    public function declaresNoAllergens(): static
    {
        return $this->state(fn (): array => [
            'declared_at' => now(),
            'declares_no_allergens' => true,
        ]);
    }
}
