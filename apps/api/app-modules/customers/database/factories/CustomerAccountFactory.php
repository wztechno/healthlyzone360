<?php

declare(strict_types=1);

namespace Healthy360\Customers\Database\Factories;

use App\Models\User;
use Healthy360\Customers\Enums\CustomerAccountOrigin;
use Healthy360\Customers\Enums\CustomerAccountStatus;
use Healthy360\Customers\Enums\CustomerAccountType;
use Healthy360\Customers\Models\CustomerAccount;
use Healthy360\Organisations\Models\Organisation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<CustomerAccount>
 */
class CustomerAccountFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            // Not `CustomerAccountNumbers`: the generator queries the table to
            // guarantee uniqueness, and a factory building two hundred rows
            // would make that two hundred round trips for a property no test
            // asserts. Uniqueness here comes from the identifier itself.
            'account_number' => 'H360-'.Str::upper(Str::random(10)),
            'account_type' => CustomerAccountType::B2c,
            'user_id' => User::factory(),
            'organisation_id' => null,
            'status' => CustomerAccountStatus::Provisional,
            'origin' => CustomerAccountOrigin::SelfService,
            'display_name' => fake()->name(),
            // Both reference codes stay null. They are real foreign keys, and
            // defaulting them to `en`/`LB` would make every test that touches
            // a customer account depend on the reference seeders having run —
            // which the RLS suite, deliberately, does not do.
            'preferred_language_code' => null,
            'country_code' => null,
            'provisional_expires_at' => now()->addDays(30),
            'last_activity_at' => now(),
        ];
    }

    public function active(): static
    {
        return $this->state(fn (): array => [
            'status' => CustomerAccountStatus::Active,
            'activated_at' => now(),
        ]);
    }

    /**
     * The guest shape: no user at all, which is what the CHECK constraint
     * demands and what makes conversion (G1) a real state change.
     */
    public function guest(): static
    {
        return $this->state(fn (): array => [
            'account_type' => CustomerAccountType::Guest,
            'user_id' => null,
            'origin' => CustomerAccountOrigin::Guest,
        ]);
    }

    public function forOrganisation(Organisation $organisation): static
    {
        return $this->state(fn (): array => [
            'account_type' => CustomerAccountType::B2b,
            'organisation_id' => $organisation->getKey(),
            'origin' => CustomerAccountOrigin::B2bProvisioning,
        ]);
    }

    /**
     * Past its window with nothing since — what the purge job looks for.
     */
    public function abandoned(): static
    {
        return $this->state(fn (): array => [
            'status' => CustomerAccountStatus::Provisional,
            'provisional_expires_at' => now()->subDay(),
            'last_activity_at' => now()->subDays(40),
        ]);
    }
}
