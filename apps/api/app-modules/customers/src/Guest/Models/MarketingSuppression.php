<?php

declare(strict_types=1);

namespace Healthy360\Customers\Guest\Models;

use Carbon\CarbonImmutable;
use Healthy360\Customers\Database\Factories\Guest\MarketingSuppressionFactory;
use Healthy360\Customers\Guest\Enums\SuppressionKind;
use Healthy360\Customers\Guest\Enums\SuppressionSource;
use Healthy360\Support\Attributes\Classified;
use Healthy360\Support\Enums\DataClassification;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * A destination that must not be contacted again.
 *
 * `contact_hash` is `Restricted` for the same reason `contact_points.value_hash`
 * is: it is a credential-shaped derivative, and exposing it turns a private
 * comparison into a public oracle for "did this address ask to be forgotten
 * here" — a question with a worse answer than the one the hash was protecting.
 *
 * The model has no relation to anything. That is the design: the row survives
 * every contact point, account and order it was derived from, which is what
 * makes an erasure stick.
 *
 * @property string $id
 * @property SuppressionKind $kind
 * @property string $contact_hash
 * @property CarbonImmutable $suppressed_at
 * @property SuppressionSource $source
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 */
#[Classified(DataClassification::Restricted, 'contact_hash')]
class MarketingSuppression extends BaseModel
{
    /** @use HasFactory<MarketingSuppressionFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => SuppressionKind::class,
            'source' => SuppressionSource::class,
            'suppressed_at' => 'datetime',
        ];
    }

    /**
     * The module lives at `Healthy360\Customers\Guest\Models`, one level deeper
     * than the modular package's resolver expects, so the mapping is stated
     * rather than guessed.
     */
    protected static function newFactory(): MarketingSuppressionFactory
    {
        return MarketingSuppressionFactory::new();
    }
}
