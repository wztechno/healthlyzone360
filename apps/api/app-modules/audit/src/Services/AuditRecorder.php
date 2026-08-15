<?php

declare(strict_types=1);

namespace Healthy360\Audit\Services;

use Healthy360\Audit\Enums\PurposeOfUse;
use Healthy360\Audit\Models\AuditLog;
use Healthy360\Support\Correlation\CorrelationContext;
use Healthy360\Support\Enums\DataClassification;
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
     * The substring match is deliberately blunt and therefore over-matches:
     * `code` catches any key containing it, so an innocent `allergen_code`
     * would be redacted into uselessness (OQ-036, risk R-019). The naming
     * convention is the mitigation until the register question is settled —
     * metadata keys never end in `_code`; write `allergen_classes` or
     * `changed_fields` instead. A test asserts the convention holds for the
     * catalogue vocabulary.
     *
     * @var list<string>
     */
    private const array REDACTED_KEYS = ['password', 'token', 'secret', 'code', 'authorization', 'cookie'];

    public function __construct(
        private readonly CorrelationContext $correlation,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  array<string, scalar|list<scalar>|null>  $metadata
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
     * Record a read of classified data.
     *
     * Distinct from record() for one reason: the purpose of use and the
     * classification of what was read are required arguments, not optional
     * ones. An access event that cannot say why it happened is not an audit
     * trail, so the type system asks for both rather than trusting each call
     * site to remember (06-security-privacy-and-audit.md §3.3).
     *
     * @param  array<string, scalar|list<scalar>|null>  $metadata
     */
    public function recordAccess(
        string $action,
        PurposeOfUse $purposeOfUse,
        DataClassification $classification,
        ?string $actorUserId = null,
        string $subjectType = 'user',
        ?string $subjectId = null,
        array $metadata = [],
    ): AuditLog {
        return $this->record(
            $action,
            $actorUserId,
            $subjectType,
            $subjectId,
            ['classification' => $classification->value] + $metadata,
            $purposeOfUse->value,
        );
    }

    /**
     * @param  array<string, scalar|list<scalar>|null>  $metadata
     * @return array<string, scalar|list<scalar>|null>
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
