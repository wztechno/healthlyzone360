<?php

declare(strict_types=1);

namespace Healthy360\Identity\Database\Factories;

use App\Models\User;
use Healthy360\Identity\Models\UserDevice;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<UserDevice>
 */
class UserDeviceFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'device_name' => fake()->randomElement(['iPhone', 'Pixel', 'Galaxy', 'Web browser']).' of '.fake()->firstName(),
            'platform' => fake()->randomElement(['ios', 'android', 'web']),
            'app_version' => '1.0.0',
            'token_reference' => (string) Str::uuid7(),
            'last_seen_at' => now(),
            'revoked_at' => null,
        ];
    }

    public function revoked(): static
    {
        return $this->state(fn (array $attributes) => ['revoked_at' => now()]);
    }
}
