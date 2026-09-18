<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Services;

use Healthy360\AccessControl\Models\Role;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;

/**
 * Turns the three identifiers in a console URL into rows, refusing anything
 * outside the caller's own organisation.
 *
 * Every failure here is `resource.not_found`, and that is the same answer
 * `B2bLocator` gives for the same reason: "no such role, as far as you are
 * concerned" is honest, and a 403 would confirm that another tenant has a role
 * with this identifier. The distinction matters more on this surface than most,
 * because a role identifier is the one thing an administrator of one kitchen
 * might plausibly learn about another.
 *
 * ## Reads go through the tenant scope, never `withoutTenancy()`
 *
 * `roles`, `organisation_memberships` and `membership_roles` all carry
 * `BelongsToOrganisation`, so the ordinary query is already filtered to the
 * organisation in context. That is the refusal — a cross-tenant identifier
 * never becomes a readable row in the first place, rather than becoming one
 * that a later check has to remember to reject. It is the reasoning
 * `OrganisationInvitationStoreController::branch()` writes out in full, and it
 * is why nothing in this module reaches for the escape hatch.
 *
 * ## A platform template is readable and is not a tenant's role
 *
 * `Role::organisationScopeAllowsNull()` is true, so the tenant scope admits
 * rows with a null `organisation_id`: the nine templates are visible in every
 * organisation, which is what makes them listable and copyable.
 * {@see self::ownRole()} is therefore the method every *write* path resolves
 * through, and it refuses a template outright. `RolePolicy` refuses it a
 * second time and the `roles` RLS policy a third; this is the first and
 * cheapest of the three, and the only one that can answer 404 instead of 403.
 */
final readonly class AccessAdministrationLocator
{
    public function __construct(private TenantContext $tenant) {}

    /**
     * The organisation named in the path, which must be the one `org.context`
     * already validated a membership against.
     *
     * @throws ApiException
     */
    public function contextOrganisation(string $id): Organisation
    {
        $active = $this->tenant->organisationId();

        if ($active === null || ! $this->looksLikeUuid($id) || $active !== $id) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $organisation = Organisation::query()->whereKey($active)->first();

        if (! $organisation instanceof Organisation) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $organisation;
    }

    /**
     * Any role this organisation may *see* — its own, or a platform template.
     *
     * @throws ApiException
     */
    public function visibleRole(string $id): Role
    {
        if (! $this->looksLikeUuid($id)) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $role = Role::query()->whereKey($id)->first();

        if (! $role instanceof Role) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $role;
    }

    /**
     * A role this organisation *owns*, which is the only kind it may change.
     *
     * A template answers 404 rather than 403 because that is what it is from
     * the writing side: there is no role at this identifier that belongs to
     * you. The console never offers Edit on a template — it offers Copy — so a
     * request that reaches here has been hand-made.
     *
     * @throws ApiException
     */
    public function ownRole(string $id): Role
    {
        $role = $this->visibleRole($id);

        if ($role->isTemplate()) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $role;
    }

    /**
     * A membership of this organisation, in any status.
     *
     * Ended memberships resolve deliberately: the console lists them behind a
     * filter because who *used* to have access is exactly what an access review
     * reads, and a detail page that 404s on the row the list just showed would
     * be a list lying about what it links to.
     *
     * @throws ApiException
     */
    public function membership(string $id): OrganisationMembership
    {
        if (! $this->looksLikeUuid($id)) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        $membership = OrganisationMembership::query()->whereKey($id)->first();

        if (! $membership instanceof OrganisationMembership) {
            throw new ApiException(ErrorCode::ResourceNotFound);
        }

        return $membership;
    }

    /**
     * A malformed identifier is not a database round trip. Postgres refuses a
     * non-UUID against a uuid column with a driver error rather than an empty
     * result, so this keeps a typo in a URL a 404 instead of a 500.
     */
    private function looksLikeUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}
