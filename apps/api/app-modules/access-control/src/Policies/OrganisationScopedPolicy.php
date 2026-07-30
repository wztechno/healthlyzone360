<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Policies;

use App\Models\User;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;

/**
 * Base policy for organisation-scoped resources. Every ability decision runs
 * through decide(): a resource whose organisation differs from the active
 * tenant context is denied outright (false, never a null pass-through —
 * Laravel's policy before() hook cannot see the model, so the guard lives
 * here), then the six-step PermissionChecker decides.
 *
 * additionalConditions() is the checker's step-6 hook: subclasses add
 * bespoke prohibitions there (explicit policies for prohibited actions,
 * plan §10) and it is invoked directly by the checker — never through the
 * Gate — so there is no recursion.
 */
abstract class OrganisationScopedPolicy
{
    public function __construct(
        protected readonly PermissionChecker $checker,
        protected readonly TenantContext $context,
    ) {}

    /**
     * Step-6 hook: bespoke policy conditions beyond the granted permission.
     * Default: no additional restrictions.
     */
    public function additionalConditions(User $user, string $permission, ?Model $resource): bool
    {
        return true;
    }

    protected function decide(User $user, string $permission, ?Model $resource = null): bool
    {
        if ($resource !== null && $this->resourceOutsideContext($resource)) {
            return false;
        }

        return $this->checker->check($user, $permission, $resource, $this->context)->allowed;
    }

    private function resourceOutsideContext(Model $resource): bool
    {
        $organisationId = $resource instanceof Organisation
            ? (string) $resource->getKey()
            : $resource->getAttribute('organisation_id');

        if ($organisationId === null) {
            return false;
        }

        return $organisationId !== $this->context->organisationId();
    }
}
