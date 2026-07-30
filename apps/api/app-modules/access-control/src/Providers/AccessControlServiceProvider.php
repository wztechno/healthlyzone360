<?php

declare(strict_types=1);

namespace Healthy360\AccessControl\Providers;

use App\Models\User;
use Healthy360\AccessControl\Models\MembershipRole;
use Healthy360\AccessControl\Models\Role;
use Healthy360\AccessControl\Models\RolePermission;
use Healthy360\AccessControl\Observers\PermissionVersionObserver;
use Healthy360\AccessControl\Policies\OrganisationBranchPolicy;
use Healthy360\AccessControl\Policies\OrganisationMembershipPolicy;
use Healthy360\AccessControl\Policies\OrganisationPolicy;
use Healthy360\AccessControl\Policies\RolePolicy;
use Healthy360\AccessControl\Services\PermissionChecker;
use Healthy360\AccessControl\Services\PermissionRegistry;
use Healthy360\Features\Models\FeatureEntitlement;
use Healthy360\Organisations\Models\Organisation;
use Healthy360\Organisations\Models\OrganisationBranch;
use Healthy360\Organisations\Models\OrganisationMembership;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AccessControlServiceProvider extends ServiceProvider
{
    /**
     * Models whose writes invalidate calculated permissions. FeatureEntitlement
     * is observed here too (entitlements feed the same /me hydration cache);
     * a domain-event mechanism can replace this direct reference later.
     *
     * @var list<class-string<Model>>
     */
    private const array PERMISSION_AFFECTING_MODELS = [
        Role::class,
        RolePermission::class,
        MembershipRole::class,
        OrganisationMembership::class,
        FeatureEntitlement::class,
    ];

    public function boot(): void
    {
        $this->registerPolicies();
        $this->registerPermissionGate();
        $this->registerVersionObservers();
    }

    private function registerPolicies(): void
    {
        Gate::policy(Organisation::class, OrganisationPolicy::class);
        Gate::policy(OrganisationBranch::class, OrganisationBranchPolicy::class);
        Gate::policy(OrganisationMembership::class, OrganisationMembershipPolicy::class);
        Gate::policy(Role::class, RolePolicy::class);
    }

    /**
     * Route permission-code abilities through the six-step PermissionChecker.
     *
     * A Gate::before hook is used (scoped strictly to registered permission
     * codes) rather than Gate::define per code, because a defined ability is
     * bypassed whenever the first argument's class has a registered policy —
     * $user->can('organisation.view_current', $organisation) would otherwise
     * be routed to OrganisationPolicy and fail to resolve a method for the
     * dotted ability name. Non-permission abilities return null and flow to
     * policies as normal. There is no superuser bypass in this phase.
     */
    private function registerPermissionGate(): void
    {
        Gate::before(function (?User $user, string $ability, array $arguments): ?bool {
            if (! PermissionRegistry::isPermissionCode($ability)) {
                return null;
            }

            $resource = $arguments[0] ?? null;

            return $this->app->make(PermissionChecker::class)->check(
                $user,
                $ability,
                $resource instanceof Model ? $resource : null,
                $this->app->make(TenantContext::class),
            )->allowed;
        });
    }

    private function registerVersionObservers(): void
    {
        foreach (self::PERMISSION_AFFECTING_MODELS as $model) {
            $model::observe(PermissionVersionObserver::class);
        }
    }
}
