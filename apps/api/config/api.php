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
    | A single workspace dashboard costs roughly twenty requests on load, and a
    | kitchen's shared tablet or a whole office behind one address spends one
    | bucket, so 600 is the shipped default, the number `deploy.sh` already
    | runs. The tighter limits on sign-in and the like are their own limiters.
    |
    */

    'rate_limit' => (int) env('API_RATE_LIMIT', 600),

];
