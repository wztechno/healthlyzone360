<?php

declare(strict_types=1);

namespace Healthy360\Support\Database\Factories;

use App\Models\User;
use Healthy360\Support\Models\IdempotencyKey;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<IdempotencyKey>
 */
class IdempotencyKeyFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => (string) Str::uuid7(),
            'user_id' => User::factory(),
            'organisation_id' => null,
            'endpoint' => 'POST /api/v1/example',
            'request_fingerprint' => hash('sha256', fake()->unique()->uuid()),
            'response_status' => '201',
            'response_snapshot' => ['data' => []],
            'expires_at' => now()->addDay(),
        ];
    }
}
