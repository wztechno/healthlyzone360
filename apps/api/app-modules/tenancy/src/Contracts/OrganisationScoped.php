<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Contracts;

/**
 * Marks an Eloquent model as organisation-owned. Implemented by every model
 * using the BelongsToOrganisation trait, which supplies the default
 * behaviour; the interface exists so the tenancy scope and the model
 * lifecycle hooks can rely on the contract instead of runtime method probing.
 */
interface OrganisationScoped
{
    /**
     * Whether rows with a NULL organisation_id (platform-global rows) are
     * legitimate and must remain visible inside any tenant context.
     */
    public function organisationScopeAllowsNull(): bool;
}
