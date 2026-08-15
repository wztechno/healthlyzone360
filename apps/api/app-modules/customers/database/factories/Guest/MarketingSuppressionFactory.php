<?php

declare(strict_types=1);

namespace Healthy360\Customers\Database\Factories\Guest;

use Healthy360\Customers\Guest\Enums\SuppressionKind;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Customers\Guest\Models\MarketingSuppression;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<MarketingSuppression>
 */
class MarketingSuppressionFactory extends Factory
{
    protected $model = MarketingSuppression::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'kind' => SuppressionKind::Email,
            // Not derived from a fake address through the hasher: a test that
            // wants a digest matching a real contact builds it through
            // MarketingSuppressionRegistry, which is the only thing that
            // guarantees the two agree.
            'contact_hash' => hash('sha256', Str::random(48)),
            'source' => SuppressionSource::Deletion,
            'suppressed_at' => now(),
        ];
    }

    public function phone(): static
    {
        return $this->state(fn (): array => ['kind' => SuppressionKind::Phone]);
    }

    public function optOut(): static
    {
        return $this->state(fn (): array => ['source' => SuppressionSource::OptOut]);
    }
}
