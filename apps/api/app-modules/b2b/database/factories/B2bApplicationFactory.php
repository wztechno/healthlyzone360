<?php

declare(strict_types=1);

namespace Healthy360\B2b\Database\Factories;

use App\Models\User;
use Healthy360\B2b\Enums\ApplicationStatus;
use Healthy360\B2b\Enums\PaymentTerms;
use Healthy360\B2b\Models\B2bApplication;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<B2bApplication>
 */
class B2bApplicationFactory extends Factory
{
    /** @var class-string<B2bApplication> */
    protected $model = B2bApplication::class;

    /**
     * A draft with every field submission requires already filled in — the
     * state most tests want to start from, since the interesting assertions
     * are about transitions rather than about typing.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $registration = mb_strtoupper(Str::random(10));

        return [
            'reference' => 'B2B-'.now()->format('Y').'-'.mb_strtoupper(Str::random(8)),
            'applicant_user_id' => User::factory(),
            'status' => ApplicationStatus::Draft,
            'legal_name' => fake()->company(),
            'country_code' => 'LB',
            'commercial_registration_number' => $registration,
            'commercial_registration_normalised' => $registration,
            'signatory_name' => fake()->name(),
            'signatory_title' => 'Managing Director',
            'signatory_email' => fake()->unique()->safeEmail(),
            'requested_payment_terms' => PaymentTerms::Net30,
            'completed_sections' => [],
            'lock_version' => 0,
        ];
    }

    /** Nothing filled in — for asserting what submission refuses. */
    public function empty(): self
    {
        return $this->state(fn (): array => [
            'legal_name' => null,
            'country_code' => null,
            'commercial_registration_number' => null,
            'commercial_registration_normalised' => null,
            'signatory_name' => null,
            'signatory_title' => null,
            'signatory_email' => null,
            'requested_payment_terms' => null,
        ]);
    }

    public function submitted(): self
    {
        return $this->state(fn (): array => [
            'status' => ApplicationStatus::Submitted,
            'submitted_at' => now(),
        ]);
    }

    public function inReview(): self
    {
        return $this->state(fn (): array => [
            'status' => ApplicationStatus::InReview,
            'submitted_at' => now()->subDay(),
            'review_started_at' => now(),
        ]);
    }

    public function declined(): self
    {
        return $this->state(fn (): array => [
            'status' => ApplicationStatus::Declined,
            'submitted_at' => now()->subDays(2),
            'decided_at' => now(),
            'applicant_message' => 'We are unable to open an account at this time.',
        ]);
    }
}
