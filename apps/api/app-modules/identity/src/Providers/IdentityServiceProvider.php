<?php

declare(strict_types=1);

namespace Healthy360\Identity\Providers;

use Healthy360\Identity\Auth\ActiveUserProvider;
use Healthy360\Identity\Contracts\ProgrammeMembershipLookup;
use Healthy360\Identity\Listeners\MarkLoginContactVerified;
use Healthy360\Identity\Models\PersonalAccessToken;
use Healthy360\Identity\Services\NullProgrammeMembershipLookup;
use Illuminate\Auth\Events\Verified;
use Illuminate\Contracts\Foundation\Application;
use Illuminate\Contracts\Hashing\Hasher;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class IdentityServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // `bindIf`: the B2B module's provider may already have registered
        // the real implementation, and a default that overwrote it would
        // silently drop every programme from `/me` in a deployment that
        // plainly has one — the same asymmetry `B2bServiceProvider` documents
        // for `SellerOpenOrders`.
        $this->app->bindIf(ProgrammeMembershipLookup::class, NullProgrammeMembershipLookup::class);
    }

    /**
     * Sanctum's tokens belong to this module: the platform identifier
     * strategy (plan §8) gives them UUIDv7 primary keys, and the table is
     * created by an identity migration rather than published from the
     * package.
     */
    public function boot(): void
    {
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);

        $this->registerUserProvider();

        // The login mirror is kept true by one listener rather than by every
        // verification path remembering to update two rows (§4.10).
        Event::listen(Verified::class, MarkLoginContactVerified::class);
    }

    /**
     * The `eloquent.active` auth provider driver, which config/auth.php
     * selects.
     *
     * Registered as a driver rather than by rebinding the guard so that the
     * choice stays visible where a reader looks for it — in the auth
     * configuration — and so a future guard that legitimately wants the stock
     * provider can still ask for `eloquent`.
     */
    private function registerUserProvider(): void
    {
        Auth::provider('eloquent.active', function (Application $app, array $config): ActiveUserProvider {
            /** @var class-string<Model> $model */
            $model = $config['model'];

            return new ActiveUserProvider($app->make(Hasher::class), $model);
        });
    }
}
