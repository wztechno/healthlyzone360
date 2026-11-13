<?php

declare(strict_types=1);

namespace Healthy360\Support\Models;

use Carbon\CarbonImmutable;
use Healthy360\Support\Database\Factories\IdempotencyKeyFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * Replay-protection record for explicitly idempotent command endpoints.
 *
 * Only the response envelope (encrypted) is snapshotted — request bodies are
 * never stored (plan §12). Rows are append-once and expire.
 *
 * @property string $id
 * @property string $key
 * @property string $user_id
 * @property string|null $organisation_id
 * @property string $endpoint
 * @property string $request_fingerprint
 * @property string|null $response_status
 * @property array<string, mixed>|null $response_snapshot
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $created_at
 */
class IdempotencyKey extends BaseModel
{
    /** @use HasFactory<IdempotencyKeyFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            // Encrypted: an envelope can carry a secret (a new staff account's
            // initial password). Write it through the model, never a query
            // builder update, which skips casts and would store plaintext.
            'response_snapshot' => 'encrypted:array',
            'expires_at' => 'datetime',
        ];
    }
}
