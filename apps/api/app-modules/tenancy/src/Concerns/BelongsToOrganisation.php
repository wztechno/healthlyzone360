<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Concerns;

use Healthy360\Organisations\Models\Organisation;
use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Healthy360\Tenancy\Exceptions\MissingTenantContext;
use Healthy360\Tenancy\Scopes\OrganisationScope;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Marks a model as organisation-owned: queries are constrained to the active
 * tenant context (fail-closed — reading or writing without a resolved
 * organisation throws MissingTenantContext, it never silently falls back to
 * unscoped access) and organisation_id is auto-filled on create.
 *
 * Models whose scoping column is nullable by design (platform template rows,
 * e.g. roles with organisation_id NULL) override organisationScopeAllowsNull()
 * so those global rows remain visible alongside the tenant's own.
 *
 * Every consuming model must also declare the OrganisationScoped interface,
 * which this trait implements.
 */
trait BelongsToOrganisation
{
    public static function bootBelongsToOrganisation(): void
    {
        static::addGlobalScope(new OrganisationScope);

        static::creating(function (OrganisationScoped&Model $model): void {
            if ($model->getAttribute('organisation_id') !== null) {
                return;
            }

            $context = app(TenantContext::class);

            if ($context->hasOrganisation()) {
                $model->setAttribute('organisation_id', $context->organisationId());

                return;
            }

            if (! $model->organisationScopeAllowsNull()) {
                throw MissingTenantContext::forModel($model);
            }
        });
    }

    /**
     * Whether rows with a NULL organisation_id (platform-global rows) are
     * legitimate and must remain visible inside any tenant context.
     */
    public function organisationScopeAllowsNull(): bool
    {
        return false;
    }

    /**
     * Explicit escape hatch for trusted cross-tenant paths (seeders, context
     * resolution). Every call site is an auditable bypass decision.
     *
     * @return Builder<static>
     */
    public static function withoutTenancy(): Builder
    {
        return static::query()->withoutGlobalScope(OrganisationScope::class);
    }

    /**
     * @return BelongsTo<Organisation, covariant static>
     */
    public function organisation(): BelongsTo
    {
        return $this->belongsTo(Organisation::class);
    }
}
