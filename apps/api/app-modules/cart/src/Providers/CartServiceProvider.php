<?php

declare(strict_types=1);

namespace Healthy360\Cart\Providers;

use Illuminate\Support\ServiceProvider;

/**
 * The Cart module binds nothing.
 *
 * Every service here is a concrete class whose dependencies the container can
 * resolve unaided, and the module declares no port of its own: it uses
 * `PriceResolver` and the catalogue models directly, which is legal in the
 * direction the registry states (Cart → Catalogues, Pricing). A port is what
 * you reach for when a dependency would otherwise run the wrong way, and there
 * is no such dependency here.
 */
class CartServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void {}
}
