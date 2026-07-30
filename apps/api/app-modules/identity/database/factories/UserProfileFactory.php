<?php

declare(strict_types=1);

namespace Healthy360\Identity\Database\Factories;

use App\Models\User;
use Healthy360\Identity\Models\UserProfile;
use Healthy360\ReferenceData\Models\Language;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<UserProfile>
 */
class UserProfileFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'given_name' => fake()->firstName(),
            'family_name' => fake()->lastName(),
            'preferred_language_code' => Language::factory(),
            'country_code' => null,
            'timezone' => 'UTC',
            'numbering_system' => 'latn',
            'date_of_birth' => null,
            'lock_version' => 0,
        ];
    }
}
