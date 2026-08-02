<?php

declare(strict_types=1);

namespace Healthy360\Customers\Database\Factories\Guest;

use Healthy360\Customers\Guest\Enums\GuestSessionGrade;
use Healthy360\Customers\Guest\Models\GuestSession;
use Healthy360\Customers\Models\CustomerAccount;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<GuestSession>
 */
class GuestSessionFactory extends Factory
{
    protected $model = GuestSession::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'customer_account_id' => CustomerAccount::factory()->guest(),
            // A digest of something random rather than of a token the factory
            // also returns: a test that needs to *use* a token gets one from
            // GuestSessionService::start(), which is the only path that mints
            // one. A factory that handed out working credentials would let a
            // test pass while the real minting path was broken.
            'token_hash' => hash('sha256', Str::random(64)),
            'grade' => GuestSessionGrade::CheckoutDraft,
            'contact_verified_at' => null,
            'expires_at' => now()->addHours(72),
            'last_used_at' => now(),
            'revoked_at' => null,
            'ip_hash' => null,
            'user_agent_hash' => null,
        ];
    }

    /**
     * The proven shape. `contact_verified_at` is set with it because the CHECK
     * constraint refuses the grade without it.
     */
    public function ordering(): static
    {
        return $this->state(fn (): array => [
            'grade' => GuestSessionGrade::PlaceOrder,
            'contact_verified_at' => now(),
        ]);
    }

    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subHour()]);
    }

    public function revoked(): static
    {
        return $this->state(fn (): array => ['revoked_at' => now()]);
    }
}
