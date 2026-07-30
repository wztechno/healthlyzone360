<?php

declare(strict_types=1);

namespace Healthy360\Tenancy;

use Closure;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\Scopes\OrganisationScope;

/**
 * Request-scoped single source of truth for the active tenant context:
 * authenticated user + active organisation membership + active branch where
 * applicable (plan §9). Populated exclusively by the tenancy middleware (or
 * queue-context restoration) — never directly from client input.
 *
 * Every mutation notifies a listener registered by TenancyServiceProvider,
 * which republishes the context to the PostgreSQL session variables the
 * row-level security policies read. Keeping that on the mutation rather than
 * on the middleware matters: /api/v1/me resolves its organisation deep inside
 * a service, long after the middleware stack has run, and the database must
 * follow the context wherever it is set — otherwise a legitimate read would
 * fail closed and simply return nothing.
 */
final class TenantContext
{
    private ?string $userId = null;

    private ?string $organisationId = null;

    private ?string $branchId = null;

    private ?OrganisationMembership $membership = null;

    /** @var (Closure(self): void)|null */
    private ?Closure $listener = null;

    /**
     * Register the single change listener. A directly constructed context
     * (unit tests, value-object use) has none and touches no database.
     *
     * @param  Closure(self): void  $listener
     */
    public function listen(Closure $listener): void
    {
        $this->listener = $listener;
    }

    /**
     * The authenticated identity with no organisation selected yet — the
     * state most authenticated requests are in. Consent grants and a person's
     * own memberships are readable from it; nothing organisation-scoped is.
     */
    public function setUser(string $userId): void
    {
        $this->userId = $userId;

        $this->synchronise();
    }

    public function setOrganisation(string $userId, string $organisationId, ?OrganisationMembership $membership = null): void
    {
        $this->userId = $userId;
        $this->organisationId = $organisationId;
        $this->membership = $membership;
        $this->branchId = null;

        $this->synchronise();
    }

    public function setBranch(string $branchId): void
    {
        $this->branchId = $branchId;

        $this->synchronise();
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

        $this->synchronise();
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
        $this->membership = null;

        $this->userId = $snapshot['user_id'] ?? null;
        $this->organisationId = $snapshot['organisation_id'] ?? null;
        $this->branchId = $snapshot['branch_id'] ?? null;

        $this->synchronise();
    }

    private function synchronise(): void
    {
        if ($this->listener !== null) {
            ($this->listener)($this);
        }
    }
}
