<?php

declare(strict_types=1);

namespace Healthy360\B2b\Database\Factories;

use Healthy360\B2b\Enums\AgreementStatus;
use Healthy360\B2b\Enums\PaymentTerms;
use Healthy360\B2b\Models\B2bAgreement;
use Healthy360\B2b\Models\B2bApplication;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<B2bAgreement>
 */
class B2bAgreementFactory extends Factory
{
    /** @var class-string<B2bAgreement> */
    protected $model = B2bAgreement::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'b2b_application_id' => B2bApplication::factory(),
            'version' => 1,
            'status' => AgreementStatus::Draft,
            'title' => 'Master supply agreement',
            'currency_code' => 'USD',
            'payment_terms' => PaymentTerms::Net30,
            'credit_limit_minor' => 500000,
            'notice_period_days' => 30,
            'auto_renews' => false,
            'lock_version' => 0,
        ];
    }

    public function pendingSignature(): self
    {
        return $this->state(fn (): array => ['status' => AgreementStatus::PendingSignature]);
    }
}
