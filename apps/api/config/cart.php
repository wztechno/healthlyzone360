<?php

declare(strict_types=1);

return [

    /*
    |--------------------------------------------------------------------------
    | Basket expiry
    |--------------------------------------------------------------------------
    |
    | How long an untouched basket stays open before `ExpireStaleCarts` closes
    | it. Every mutation pushes the deadline out, so the window measures
    | inactivity rather than age — a customer who has been adding to the same
    | basket for a week is not abandoning it.
    |
    | Three days is a product choice, not a rule, and it lives here so that a
    | launch weekend can widen it without a deploy. Nothing is reserved by a
    | cart, so the number costs nothing but tidiness: expiry frees the
    | customer's one-open-cart slot on the channel and closes the row, and the
    | lines are kept either way.
    |
    */

    'expiry' => [
        'ttl_minutes' => (int) env('CART_TTL_MINUTES', 4320),
    ],

];
