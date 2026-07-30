<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Policies;

use App\Models\User;
use Healthy360\Organisations\Models\Organisation;

class OrganisationPolicy extends OrganisationScopedPolicy
{
    public function view(User $user, Organisation $organisation): bool
    {
        return $this->decide($user, 'organisation.view_current', $organisation);
    }

    public function update(User $user, Organisation $organisation): bool
    {
        return $this->decide($user, 'organisation.update_current', $organisation);
    }
}
