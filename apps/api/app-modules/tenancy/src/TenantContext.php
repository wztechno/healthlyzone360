<?php

declare(strict_types=1);

namespace Healthy360\Tenancy;

use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Scopes\OrganisationScope;

/**
 * Request-scoped single source of truth for the active tenant context:
 * authenticated user + active organisation membership + active branch where
 * applicable (plan §9). Populated exclusively by the tenancy middleware (or
 * queue-context restoration) — never directly from client input.
 */
final class TenantContext
{
    private ?string $userId = null;

    private ?string $organisationId = null;

    private ?string $branchId = null;

    private ?OrganisationMembership $membership = null;

    public function setOrganisation(string $userId, string $organisationId, ?OrganisationMembership $membership = null): void
    {
        $this->userId = $userId;
        $this->organisationId = $organisationId;
        $this->membership = $membership;
        $this->branchId = null;
    }

    public function setBranch(string $branchId): void
    {
        $this->branchId = $branchId;
    }

    public function userId(): ?string
    {
        return $this->userId;
    }

    public function organisationId(): ?string
    {
        return $this->organisationId;
    }

    public function branchId(): ?string
    {
        return $this->branchId;
    }

    public function hasOrganisation(): bool
    {
        return $this->organisationId !== null;
    }

    /**
     * The active membership backing this context. Restored queue contexts
     * carry identifiers only, so the membership is re-read on demand.
     */
    public function membership(): ?OrganisationMembership
    {
        if ($this->membership === null && $this->userId !== null && $this->organisationId !== null) {
            $this->membership = OrganisationMembership::query()
                ->withoutGlobalScope(OrganisationScope::class)
                ->where('organisation_id', $this->organisationId)
                ->where('user_id', $this->userId)
                ->first();
        }

        return $this->membership;
    }

    public function clear(): void
    {
        $this->userId = null;
        $this->organisationId = null;
        $this->branchId = null;
        $this->membership = null;
    }

    /**
     * Serialisable snapshot for queue propagation (identifiers only).
     *
     * @return array{user_id: string|null, organisation_id: string|null, branch_id: string|null}
     */
    public function toArray(): array
    {
        return [
            'user_id' => $this->userId,
            'organisation_id' => $this->organisationId,
            'branch_id' => $this->branchId,
        ];
    }

    /**
     * Restore a context snapshot inside a queue worker.
     *
     * @param  array{user_id?: string|null, organisation_id?: string|null, branch_id?: string|null}  $snapshot
     */
    public function restore(array $snapshot): void
    {
        $this->clear();

        $this->userId = $snapshot['user_id'] ?? null;
        $this->organisationId = $snapshot['organisation_id'] ?? null;
        $this->branchId = $snapshot['branch_id'] ?? null;
    }
}
