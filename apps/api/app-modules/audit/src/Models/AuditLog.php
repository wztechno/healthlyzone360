<?php

declare(strict_types=1);

namespace Healthy360\Audit\Models;

use App\Models\User;
use Carbon\CarbonImmutable;
use Healthy360\Audit\Database\Factories\AuditLogFactory;
use Healthy360\Support\Models\BaseModel;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Append-only audit event (safe audit-event contract, plan §12): no
 * updated_at, and the application database role loses UPDATE/DELETE on this
 * table in Phase 6. Metadata is redacted — never secrets, request bodies or
 * medical content.
 *
 * @property string $id
 * @property string|null $actor_user_id null for system events
 * @property string|null $organisation_id
 * @property string|null $branch_id
 * @property string $action
 * @property string $subject_type
 * @property string|null $subject_id
 * @property string|null $purpose_of_use required for sensitive accesses
 * @property string|null $correlation_id
 * @property array<string, mixed>|null $metadata
 * @property CarbonImmutable $occurred_at
 * @property CarbonImmutable|null $created_at
 */
class AuditLog extends BaseModel
{
    /** @use HasFactory<AuditLogFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'metadata' => 'array',
            'occurred_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
