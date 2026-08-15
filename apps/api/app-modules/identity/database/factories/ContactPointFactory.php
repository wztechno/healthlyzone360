<?php

declare(strict_types=1);

namespace Healthy360\Identity\Database\Factories;

use App\Models\User;
use Healthy360\Identity\Enums\ContactChannel;
use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Identity\Services\ContactValueHasher;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ContactPoint>
 */
class ContactPointFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $value = fake()->unique()->safeEmail();

        return [
            'user_id' => User::factory(),
            'customer_account_id' => null,
            'channel' => ContactChannel::Email,
            'value_normalised' => $value,
            'value_hash' => app(ContactValueHasher::class)->hash($value),
            'label' => null,
            'is_login_identity' => false,
            'is_primary' => false,
            'verified_at' => null,
            'retired_at' => null,
            'source' => 'self_service',
        ];
    }

    public function phone(): static
    {
        return $this->state(function (): array {
            $value = '+9611'.fake()->unique()->numerify('######');

            return [
                'channel' => ContactChannel::Phone,
                'value_normalised' => $value,
                'value_hash' => app(ContactValueHasher::class)->hash($value),
            ];
        });
    }

    public function verified(): static
    {
        return $this->state(fn (): array => ['verified_at' => now()]);
    }

    /**
     * Owned by a customer account rather than by an identity — the guest shape.
     * The user column is cleared because the exactly-one CHECK refuses both.
     */
    public function forCustomerAccount(string $customerAccountId): static
    {
        return $this->state(fn (): array => [
            'user_id' => null,
            'customer_account_id' => $customerAccountId,
        ]);
    }
}
