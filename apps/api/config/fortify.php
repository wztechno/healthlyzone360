<?php

use Laravel\Fortify\Features;

return [

    /*
    |--------------------------------------------------------------------------
    | Fortify Guard
    |--------------------------------------------------------------------------
    |
    | Here you may specify which authentication guard Fortify will use while
    | authenticating users. This value should correspond with one of your
    | guards that is already present in your "auth" configuration file.
    |
    */

    'guard' => 'web',

    /*
    |--------------------------------------------------------------------------
    | Fortify Password Broker
    |--------------------------------------------------------------------------
    |
    | Here you may specify which password broker Fortify can use when a user
    | is resetting their password. This configured value should match one
    | of your password brokers setup in your "auth" configuration file.
    |
    */

    'passwords' => 'users',

    /*
    |--------------------------------------------------------------------------
    | Username / Email
    |--------------------------------------------------------------------------
    |
    | This value defines which model attribute should be considered as your
    | application's "username" field. Typically, this might be the email
    | address of the users but you are free to change this value here.
    |
    | Out of the box, Fortify expects forgot password and reset password
    | requests to have a field named 'email'. If the application uses
    | another name for the field you may define it below as needed.
    |
    */

    'username' => 'email',

    'email' => 'email',

    /*
    |--------------------------------------------------------------------------
    | Lowercase Usernames
    |--------------------------------------------------------------------------
    |
    | This value defines whether usernames should be lowercased before saving
    | them in the database, as some database system string fields are case
    | sensitive. You may disable this for your application if necessary.
    |
    */

    'lowercase_usernames' => true,

    /*
    |--------------------------------------------------------------------------
    | Home Path
    |--------------------------------------------------------------------------
    |
    | Healthy360 is a headless JSON API: no authentication response redirects
    | anywhere, so this value is never used. It is kept valid rather than
    | removed because Fortify reads it unconditionally.
    |
    */

    'home' => '/',

    /*
    |--------------------------------------------------------------------------
    | Fortify Routes Prefix / Subdomain
    |--------------------------------------------------------------------------
    |
    | Every authentication endpoint lives under /api/v1/auth (plan §13). The
    | routes themselves are declared in routes/api-v1-auth.php rather than by
    | Fortify (Fortify::ignoreRoutes() in FortifyServiceProvider), but the
    | group is registered with this prefix and middleware, so this file stays
    | the single description of where authentication lives.
    |
    */

    'prefix' => 'api/v1/auth',

    'domain' => null,

    /*
    |--------------------------------------------------------------------------
    | Fortify Routes Middleware
    |--------------------------------------------------------------------------
    |
    | The `api` group: correlation identifiers, Sanctum stateful-domain
    | handling (cookie sessions for first-party origins, bearer tokens
    | elsewhere) and the global 60/minute API limiter.
    |
    */

    'middleware' => ['api'],

    /*
    |--------------------------------------------------------------------------
    | Rate Limiting
    |--------------------------------------------------------------------------
    |
    | Named limiters registered in App\Providers\FortifyServiceProvider.
    |
    | `login` is deliberately null: login throttling is performed inside the
    | authentication pipeline by Fortify's EnsureLoginIsNotThrottled (5/minute
    | per email + IP), which raises Illuminate\Auth\Events\Lockout so the
    | attempt is audited. A route-level limiter would count successes too and
    | would never raise that event.
    |
    */

    'limiters' => [
        'login' => null,
        'two-factor' => 'two-factor',
        'forgot-password' => 'forgot-password',
        'verification' => 'verification',
    ],

    /*
    |--------------------------------------------------------------------------
    | Register View Routes
    |--------------------------------------------------------------------------
    |
    | Here you may specify if the routes returning views should be disabled as
    | you may not need them when building your own application. This may be
    | especially true if you're writing a custom single-page application.
    |
    */

    'views' => false,

    /*
    |--------------------------------------------------------------------------
    | Features
    |--------------------------------------------------------------------------
    |
    | Some of the Fortify features are optional. You may disable the features
    | by removing them from this array. You're free to only remove some of
    | these features, or you can even remove all of these if you need to.
    |
    */

    'features' => [
        Features::registration(),
        Features::resetPasswords(),
        Features::emailVerification(),
        Features::twoFactorAuthentication([
            'confirm' => true,
            'confirmPassword' => false,
            // 'window' => 0
        ]),
    ],

];
