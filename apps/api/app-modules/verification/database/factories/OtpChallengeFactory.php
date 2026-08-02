<?php

declare(strict_types=1);

namespace Healthy360\Verification\Database\Factories;

use Healthy360\Identity\Models\ContactPoint;
use Healthy360\Verification\Enums\OtpChallengeStatus;
use Healthy360\Verification\Enums\OtpChannel;
use Healthy360\Verification\Enums\OtpPurpose;
use Healthy360\Verification\Models\OtpChallenge;
use Healthy360\Verification\Services\OtpCodeHasher;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OtpChallenge>
 */
class OtpChallengeFactory extends Factory
{
    /**
     * A live email challenge for a fresh contact point.
     *
     * The default code is `'424242'` — the same well-known value the frontend
     * mock uses (appendix E) — so a test that needs to verify a challenge does
     * not have to reach into the hasher, and so the two sides of the stack
     * agree on what an obviously-fake passcode looks like.
     */
    public const string CODE = '424242';

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $contact = ContactPoint::factory()->create();

        return [
            'contact_point_id' => $contact->getKey(),
            'user_id' => $contact->user_id,
            'customer_account_id' => $contact->customer_account_id,
            'purpose' => OtpPurpose::ContactVerification,
            'channel' => OtpChannel::Email,
            'destination_masked' => 'a•••@example.com',
            'code_hash' => app(OtpCodeHasher::class)->hash(self::CODE),
            'status' => OtpChallengeStatus::Pending,
            'attempts' => 0,
            'max_attempts' => 3,
            'resend_count' => 0,
            'max_resends' => 3,
            'expires_at' => now()->addMinutes(5),
            'last_sent_at' => now(),
            'resend_available_at' => now()->addSeconds(45),
        ];
    }

    public function forContact(ContactPoint $contact): static
    {
        return $this->state(fn (): array => [
            'contact_point_id' => $contact->getKey(),
            'user_id' => $contact->user_id,
            'customer_account_id' => $contact->customer_account_id,
        ]);
    }

    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subMinute()]);
    }

    /**
     * The cooldown still running — a resend at this point must be refused.
     */
    public function inCooldown(): static
    {
        return $this->state(fn (): array => ['resend_available_at' => now()->addSeconds(30)]);
    }
}
