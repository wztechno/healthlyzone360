<?php

declare(strict_types=1);

use Healthy360\Identity\Http\Middleware\EnsureFrontendRequestsAreStateful;
use Illuminate\Http\Request;

/*
|--------------------------------------------------------------------------
| Sanctum stateful-domain detection for bearer clients
|--------------------------------------------------------------------------
|
| The branch that separates cookie-session SPAs from Expo clients, which send
| Origin on cross-origin fetches but authenticate with bearer tokens.
|
*/

it('does not treat a bearer client as a stateful frontend', function (): void {
    $request = Request::create('/api/v1/auth/token', 'POST');
    $request->headers->set('Origin', 'http://localhost:8081');
    $request->headers->set('X-Client-Platform', 'web');

    expect(EnsureFrontendRequestsAreStateful::fromFrontend($request))->toBeFalse();
});

it('still treats a session client without X-Client-Platform as stateful', function (): void {
    $request = Request::create('/api/v1/auth/login', 'POST');
    $request->headers->set('Origin', 'http://localhost:8081');

    expect(EnsureFrontendRequestsAreStateful::fromFrontend($request))->toBeTrue();
});

it('does not treat requests without a stateful origin as frontend', function (): void {
    $request = Request::create('/api/v1/auth/token', 'POST');
    $request->headers->set('X-Client-Platform', 'ios');

    expect(EnsureFrontendRequestsAreStateful::fromFrontend($request))->toBeFalse();
});
