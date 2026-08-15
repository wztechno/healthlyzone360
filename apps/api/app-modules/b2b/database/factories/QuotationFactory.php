<?php

declare(strict_types=1);

namespace Healthy360\B2b\Database\Factories;

use Healthy360\B2b\Enums\QuotationStatus;
use Healthy360\B2b\Models\CorporateProgramme;
use Healthy360\B2b\Models\Quotation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Quotation>
 */
class QuotationFactory extends Factory
{
    /** @var class-string<Quotation> */
    protected $model = Quotation::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'corporate_programme_id' => CorporateProgramme::factory(),
            'organisation_id' => fn (array $attributes): ?string => CorporateProgramme::withoutTenancy()
                ->whereKey($attributes['corporate_programme_id'] ?? null)
                ->value('organisation_id'),
            'reference' => 'QUO-'.now()->format('Y').'-'.mb_strtoupper(Str::random(8)),
            'status' => QuotationStatus::Draft,
            'currency_code' => 'USD',
            'lock_version' => 0,
        ];
    }

    public function submitted(): self
    {
        return $this->state(fn (): array => [
            'status' => QuotationStatus::Submitted,
            'submitted_at' => now(),
        ]);
    }

    public function quoted(): self
    {
        return $this->state(fn (): array => [
            'status' => QuotationStatus::Quoted,
            'submitted_at' => now()->subDay(),
            'quoted_at' => now(),
            'expires_at' => now()->addDays(7),
        ]);
    }

    public function accepted(): self
    {
        return $this->state(fn (): array => [
            'status' => QuotationStatus::Accepted,
            'submitted_at' => now()->subDays(2),
            'quoted_at' => now()->subDay(),
            'expires_at' => now()->addDays(6),
            'decided_at' => now(),
        ]);
    }

    public function expired(): self
    {
        return $this->state(fn (): array => [
            'status' => QuotationStatus::Expired,
            'submitted_at' => now()->subDays(10),
            'quoted_at' => now()->subDays(8),
            'expires_at' => now()->subDay(),
        ]);
    }
}
