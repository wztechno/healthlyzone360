<?php

declare(strict_types=1);

namespace Healthy360\Kitchens\Providers;

use Illuminate\Support\ServiceProvider;

/**
 * The kitchens module binds nothing in K1.7.
 *
 * It owns one table — a branch's operating week — and its service is a
 * constructor-injected concrete the container resolves by autowiring. Menus,
 * approved meal-plan receipt and kitchen instructions arrive with the phases
 * that need them; this provider gains bindings then, not before.
 */
class KitchensServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void {}
}
