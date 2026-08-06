<?php

declare(strict_types=1);

namespace Healthy360\PlatformAdministration\Providers;

use Healthy360\B2b\Contracts\InvitationMembershipGranter;
use Healthy360\PlatformAdministration\Services\MembershipGranter;
use Illuminate\Support\ServiceProvider;

/**
 * The platform administration module.
 *
 * ## Why this module exists at all
 *
 * `docs/architecture/module-registry.yaml` has carried a `PlatformAdministration`
 * entry since phase 1, marked `active`, with a note saying the surface
 * "arrives with the phase that needs it". PA1 is that phase, and the reason
 * the code could not simply go into Organisations is a hard one rather than a
 * preference: a tenant-lifecycle console has to write `organisation_memberships`
 * *and* `membership_roles`, and it has to reuse the `organisation_invitations`
 * machinery. Those live in AccessControl and B2B, both of which depend on
 * Organisations. Putting the console in Organisations would have run two
 * dependency edges backwards and made the module graph cyclic — which the
 * architecture test checks and which is, more to the point, actually wrong.
 *
 * This module sits *above* all of them, which is what a console is: something
 * that composes capabilities other modules own. Its registry entry has been
 * updated with the one edge it added, `B2B`.
 *
 * ## It binds one thing
 *
 * `InvitationMembershipGranter`, B2B's port, over the `UngrantedMembership`
 * default. That is the whole reason the port exists: B2B can prove an
 * invitation is valid and must not be able to grant access, so the module that
 * owns tenant lifecycle supplies the write.
 *
 * `bind`, not `bindIf`, and the asymmetry with B2B's own registration is
 * deliberate — the same reasoning `B2bServiceProvider` writes about
 * `B2bSignatoryPresence`. B2B registers the null default with `bindIf`
 * precisely so that whichever module can genuinely answer wins; a `bindIf` on
 * both sides would make the winner depend on provider order, which is how an
 * invitation comes to be accepted without a membership in a deployment that
 * plainly has a platform console.
 *
 * The HTTP surface is declared centrally in `routes/api-v1.php` like every
 * other family, so this provider registers no routes.
 */
class PlatformAdministrationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->bind(InvitationMembershipGranter::class, MembershipGranter::class);
    }

    public function boot(): void
    {
        $this->loadViewsFrom(__DIR__.'/../../resources/views', 'platform-administration');
    }
}
