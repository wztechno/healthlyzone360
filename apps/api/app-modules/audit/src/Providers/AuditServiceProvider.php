<?php

declare(strict_types=1);

namespace Healthy360\Audit\Providers;

use Healthy360\Audit\Listeners\AuthenticationEventSubscriber;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;

class AuditServiceProvider extends ServiceProvider
{
    /**
     * Authentication auditing is wired here rather than through event
     * discovery so the contract is visible in one place.
     */
    public function boot(): void
    {
        Event::subscribe(AuthenticationEventSubscriber::class);
    }
}
