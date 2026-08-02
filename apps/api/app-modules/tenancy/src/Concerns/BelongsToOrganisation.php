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
use LogicException;

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
    /**
     * Whether organisation_id auto-fill is suspended for this model class.
     * Set only for the duration of an `asPlatformRow()` callback.
     */
    protected static bool $platformRowWriteInProgress = false;

    public static function bootBelongsToOrganisation(): void
    {
        static::addGlobalScope(new OrganisationScope);

        static::creating(function (OrganisationScoped&Model $model): void {
            if ($model->getAttribute('organisation_id') !== null) {
                return;
            }

            if (static::$platformRowWriteInProgress) {
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
     * Write platform-global rows (organisation_id NULL) while a tenant
     * context is active.
     *
     * Without this the auto-fill would stamp the caller's organisation onto a
     * row that is meant to belong to nobody — a platform operator editing the
     * shared allergen baseline would silently create its own private overlay
     * instead, and the baseline every other tenant reads would never change.
     * Seeders do not need it (they run with no context at all); an
     * authenticated platform-operator surface does.
     *
     * Narrow by construction: it only suppresses the auto-fill for models
     * whose scope already permits NULL rows, only inside the callback, and
     * only for the model class it is called on. Every call site is an
     * auditable decision, exactly like `withoutTenancy()`.
     *
     * @template TReturn
     *
     * @param  callable(): TReturn  $callback
     * @return TReturn
     */
    public static function asPlatformRow(callable $callback): mixed
    {
        if (! static::query()->getModel()->organisationScopeAllowsNull()) {
            throw new LogicException(sprintf(
                '[%s] has no platform-global rows: organisationScopeAllowsNull() is false.',
                static::class,
            ));
        }

        static::$platformRowWriteInProgress = true;

        try {
            return $callback();
        } finally {
            static::$platformRowWriteInProgress = false;
        }
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
