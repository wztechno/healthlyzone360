<?php

declare(strict_types=1);

namespace Healthy360\Tenancy\Exceptions;

use Illuminate\Database\Eloquent\Model;
use RuntimeException;

/**
 * Thrown when an organisation-scoped model is queried or created without a
 * resolved tenant context. Deliberately fail-closed: unscoped access to
 * tenant data is never a silent default.
 */
class MissingTenantContext extends RuntimeException
{
    public static function forModel(Model $model): self
    {
        return new self(sprintf(
            'Tenant context is not set; refusing organisation-scoped access to [%s]. '
            .'Resolve a context first, or opt out explicitly with withoutTenancy().',
            $model::class,
        ));
    }
}
