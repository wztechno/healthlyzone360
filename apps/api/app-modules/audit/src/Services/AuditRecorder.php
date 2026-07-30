<?php

declare(strict_types=1);

namespace Healthy360\Audit\Services;

use Healthy360\Audit\Models\AuditLog;
use Healthy360\Support\Correlation\CorrelationContext;
use Healthy360\Tenancy\TenantContext;

/**
 * The single write path for audit events (safe audit-event contract,
 * plan §12).
 *
 * Every row is stamped with the active tenant context and the request
 * correlation identifier, and metadata passes through a redaction filter:
 * credentials, tokens and secrets can never be persisted here, whatever a
 * caller passes in. Request bodies, payment payloads and medical content are
 * out of scope by contract and must not be handed to this service at all.
 */
final class AuditRecorder
{
    /**
     * Metadata keys whose value is dropped, matched case-insensitively as a
     * substring so `two_factor_secret` and `access_token` are caught too.
     *
     * @var list<string>
     */
    private const array REDACTED_KEYS = ['password', 'token', 'secret', 'code', 'authorization', 'cookie'];

    public function __construct(
        private readonly CorrelationContext $correlation,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  array<string, scalar|null>  $metadata
     */
    public function record(
        string $action,
        ?string $actorUserId = null,
        string $subjectType = 'user',
        ?string $subjectId = null,
        array $metadata = [],
        ?string $purposeOfUse = null,
    ): AuditLog {
        return AuditLog::query()->create([
            'actor_user_id' => $actorUserId,
            'organisation_id' => $this->tenant->organisationId(),
            'branch_id' => $this->tenant->branchId(),
            'action' => $action,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId ?? $actorUserId,
            'purpose_of_use' => $purposeOfUse,
            'correlation_id' => $this->correlation->correlationId(),
            'metadata' => $this->redact($metadata),
            'occurred_at' => now(),
        ]);
    }

    /**
     * @param  array<string, scalar|null>  $metadata
     * @return array<string, scalar|null>
     */
    private function redact(array $metadata): array
    {
        $redacted = [];

        foreach ($metadata as $key => $value) {
            $redacted[$key] = $this->isSensitive($key) ? '[redacted]' : $value;
        }

        return $redacted;
    }

    private function isSensitive(string $key): bool
    {
        $lower = strtolower($key);

        foreach (self::REDACTED_KEYS as $needle) {
            if (str_contains($lower, $needle)) {
                return true;
            }
        }

        return false;
    }
}
