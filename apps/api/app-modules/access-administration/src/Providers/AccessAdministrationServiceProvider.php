<?php

declare(strict_types=1);

namespace Healthy360\AccessAdministration\Providers;

use Illuminate\Support\ServiceProvider;

/**
 * The tenant's own access console.
 *
 * ## Why this module exists, and why it is not AccessControl
 *
 * `access-control` is the kernel: a permission checker, a cache, a route
 * middleware and four policies, imported by twelve modules and deliberately
 * carrying no HTTP surface at all. Giving it controllers would hand a
 * controller directory to every module that only wanted to ask whether
 * somebody may do something.
 *
 * The harder reason is a dependency edge. This console offers a staff account
 * two ways — an invitation, or a login created on the spot — and the
 * invitation half reuses `InvitationService`, which lives in B2B. B2B already
 * depends on AccessControl (`module-registry.yaml`), so an
 * `AccessControl → B2B` edge closes a cycle that `ModuleRegistryTest` fails on.
 * It is the same argument `PlatformAdministrationServiceProvider` makes about
 * its own existence, arrived at from the other side: a console composes
 * capabilities other modules own, so it sits above them.
 *
 * It is also not PlatformAdministration. Every route there is behind
 * `platform.context` because the subject is *somebody else's* tenant. Here the
 * subject is the caller's own organisation, and there is no platform gate
 * anywhere in the surface.
 *
 * ## It binds nothing, and registers no routes
 *
 * There is no port here for another module to fill: everything this module
 * needs, it either owns or reads through a published service. The HTTP surface
 * is declared centrally in `routes/api-v1.php` like every other family, next
 * to the invitation block it completes.
 *
 * The provider therefore exists to satisfy `internachi/modular`'s discovery
 * and to be the obvious place for a binding the day one is needed. That is a
 * real job, and an empty provider that says why it is empty is better than a
 * module the package cannot see.
 */
class AccessAdministrationServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        //
    }
}
