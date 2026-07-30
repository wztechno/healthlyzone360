<?php

declare(strict_types=1);

namespace Healthy360\Identity\Providers;

use Healthy360\Identity\Models\PersonalAccessToken;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class IdentityServiceProvider extends ServiceProvider
{
    /**
     * Sanctum's tokens belong to this module: the platform identifier
     * strategy (plan §8) gives them UUIDv7 primary keys, and the table is
     * created by an identity migration rather than published from the
     * package.
     */
    public function boot(): void
    {
        Sanctum::usePersonalAccessTokenModel(PersonalAccessToken::class);
    }
}
