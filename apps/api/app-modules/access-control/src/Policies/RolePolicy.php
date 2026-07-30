<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Policies;

use App\Models\User;
use Healthy360\AccessControl\Models\Role;
use Illuminate\Database\Eloquent\Model;

class RolePolicy extends OrganisationScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->decide($user, 'role.view_organisation');
    }

    public function view(User $user, Role $role): bool
    {
        return $this->decide($user, 'role.view_organisation', $role);
    }

    public function create(User $user): bool
    {
        return $this->decide($user, 'role.manage_organisation');
    }

    public function update(User $user, Role $role): bool
    {
        return $this->decide($user, 'role.manage_organisation', $role);
    }

    public function delete(User $user, Role $role): bool
    {
        return $this->decide($user, 'role.manage_organisation', $role);
    }

    /**
     * Explicit prohibition (plan §10): platform-defined system roles are
     * never editable from inside a tenant, whatever permissions are granted.
     */
    public function additionalConditions(User $user, string $permission, ?Model $resource): bool
    {
        if ($permission === 'role.manage_organisation' && $resource instanceof Role && $resource->is_system) {
            return false;
        }

        return true;
    }
}
