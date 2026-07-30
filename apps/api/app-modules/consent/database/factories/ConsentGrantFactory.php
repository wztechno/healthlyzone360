<?php

declare(strict_types=1);

namespace Healthy360\Consent\Database\Factories;

use App\Models\User;
use Healthy360\Consent\Enums\ConsentStatus;
use Healthy360\Consent\Models\ConsentDefinition;
use Healthy360\Consent\Models\ConsentGrant;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ConsentGrant>
 */
class ConsentGrantFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'consent_definition_id' => ConsentDefinition::factory(),
            'organisation_id' => null,
            'status' => ConsentStatus::Granted,
            'granted_at' => now(),
            'withdrawn_at' => null,
            'channel' => fake()->randomElement(['web', 'ios', 'android']),
        ];
    }

    public function withdrawn(): static
    {
        return $this->state(fn (array $attributes) => [
            'status' => ConsentStatus::Withdrawn,
            'withdrawn_at' => now(),
        ]);
    }
}
