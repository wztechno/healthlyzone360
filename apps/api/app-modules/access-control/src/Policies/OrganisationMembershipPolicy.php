<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Policies;

use App\Models\User;
use Healthy360\Organisations\Models\OrganisationMembership;

class OrganisationMembershipPolicy extends OrganisationScopedPolicy
{
    public function viewAny(User $user): bool
    {
        return $this->decide($user, 'membership.view_organisation');
    }

    public function view(User $user, OrganisationMembership $membership): bool
    {
        return $this->decide($user, 'membership.view_organisation', $membership);
    }

    public function create(User $user): bool
    {
        return $this->decide($user, 'membership.invite_organisation');
    }

    public function update(User $user, OrganisationMembership $membership): bool
    {
        return $this->decide($user, 'membership.update_organisation', $membership);
    }

    public function delete(User $user, OrganisationMembership $membership): bool
    {
        return $this->decide($user, 'membership.end_organisation', $membership);
    }
}
