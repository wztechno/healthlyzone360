<?php

declare(strict_types=1);

namespace Healthy360\Delivery\Providers;

use Illuminate\Support\ServiceProvider;

/**
 * The delivery module binds nothing.
 *
 * Its services are constructor-injected concretes the container resolves by
 * autowiring, and it publishes no port for another module to implement.
 * `ZoneResolver` — the class J1's address validation and C1's checkout will
 * call — is deliberately a concrete rather than an interface: a delivery
 * precedence with two implementations is two precedences.
 */
class DeliveryServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void {}
}
