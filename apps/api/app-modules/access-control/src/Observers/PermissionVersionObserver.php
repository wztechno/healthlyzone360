<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Observers;

use Healthy360\AccessControl\Services\PermissionCache;
use Illuminate\Database\Eloquent\Model;

/**
 * Bumps the permission-version counter whenever a permission-affecting model
 * (role, role permission, membership role, membership, feature entitlement)
 * is written, so cached calculated permissions are invalidated immediately
 * instead of waiting for the TTL.
 */
final class PermissionVersionObserver
{
    public function __construct(private readonly PermissionCache $cache) {}

    public function saved(Model $model): void
    {
        $this->bump($model);
    }

    public function deleted(Model $model): void
    {
        $this->bump($model);
    }

    private function bump(Model $model): void
    {
        $organisationId = $model->getAttribute('organisation_id');

        $this->cache->bumpVersion(is_string($organisationId) ? $organisationId : null);
    }
}
