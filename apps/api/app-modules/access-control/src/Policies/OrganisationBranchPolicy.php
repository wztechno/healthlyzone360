<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Policies;

use App\Models\User;
use Healthy360\Organisations\Models\OrganisationBranch;

class OrganisationBranchPolicy extends OrganisationScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->decide($user, 'branch.view_current');
    }

    public function view(User $user, OrganisationBranch $branch): bool
    {
        return $this->decide($user, 'branch.view_current', $branch);
    }

    public function create(User $user): bool
    {
        return $this->decide($user, 'branch.manage_current');
    }

    public function update(User $user, OrganisationBranch $branch): bool
    {
        return $this->decide($user, 'branch.manage_current', $branch);
    }

    public function delete(User $user, OrganisationBranch $branch): bool
    {
        return $this->decide($user, 'branch.manage_current', $branch);
    }
}
