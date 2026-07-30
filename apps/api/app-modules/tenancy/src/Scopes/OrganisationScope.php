<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Scopes;

use Healthy360\Tenancy\Contracts\OrganisationScoped;
use Healthy360\Tenancy\Exceptions\MissingTenantContext;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;

/**
 * Global scope constraining organisation-owned models to the active tenant
 * context. Fails closed: querying a scoped model without a resolved
 * organisation context throws instead of silently returning unscoped rows.
 * Trusted cross-tenant paths (seeders, context resolution itself) must opt
 * out explicitly via withoutGlobalScope()/withoutTenancy().
 *
 * @implements Scope<Model>
 */
final class OrganisationScope implements Scope
{
    /**
     * @param  Builder<covariant Model>  $builder
     */
    public function apply(Builder $builder, Model $model): void
    {
        $context = app(TenantContext::class);

        if (! $context->hasOrganisation()) {
            throw MissingTenantContext::forModel($model);
        }

        $column = $model->qualifyColumn('organisation_id');

        if ($model instanceof OrganisationScoped && $model->organisationScopeAllowsNull()) {
            $builder->where(function (Builder $query) use ($column, $context): void {
                $query->where($column, $context->organisationId())
                    ->orWhereNull($column);
            });

            return;
        }

        $builder->where($column, $context->organisationId());
    }
}
