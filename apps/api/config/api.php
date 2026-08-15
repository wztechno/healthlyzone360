<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | API rate limit
    |--------------------------------------------------------------------------
    |
    | Requests per minute allowed on the `api` middleware group, keyed by the
    | authenticated user and falling back to the caller's address (see
    | AppServiceProvider::configureRateLimiting).
    |
    | Sixty is the shipped default and the number the limiter test pins. It is
    | configurable because a shared demonstration instance breaks the
    | assumption the number was chosen under: several testers sign in as the
    | *same* seeded persona, so they share one bucket, while a single workspace
    | dashboard costs roughly twenty requests on load. Raise it there; leave it
    | alone anywhere a caller is a real person with their own account.
    |
    */

    'rate_limit' => (int) env('API_RATE_LIMIT', 60),

];
