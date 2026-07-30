<?php

declare(strict_types=1);

use Healthy360\Identity\Http\Controllers\ContextController;
use Healthy360\Identity\Http\Controllers\DeviceController;
use Healthy360\Identity\Http\Controllers\MeController;
use Healthy360\Identity\Http\Controllers\MembershipController;
use Healthy360\Organisations\Http\Controllers\CurrentOrganisationController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Healthy360 API — version 1
|--------------------------------------------------------------------------
|
| Registered by bootstrap/app.php with the `api` middleware group and the
| /api/v1 prefix. Authentication endpoints live in routes/api-v1-auth.php,
| under the prefix declared by config/fortify.php.
|
| Every route here answers in the Healthy360 envelope
| (docs/api/conventions.md) and appears in openapi/healthy360.v1.yaml — a
| Pest test asserts that correspondence in both directions.
|
| `auth:sanctum` covers both credentials: a first-party cookie session (the
| Sanctum guard falls back to the `web` guard) and a bearer personal access
| token. `verified` is Healthy360's JSON email-verification guard.
|
| `db.context` publishes the authenticated identity to the PostgreSQL session
| variables the row-level security policies read, and resets them once the
| response has been sent (plan §11, ADR-0007).
|
*/

Route::middleware(['auth:sanctum', 'db.context', 'device.touch'])->group(function (): void {
    // Deliberately reachable before email verification: the client needs
    // this payload to render the "verify your email" state.
    Route::get('/me', MeController::class)->name('me.show');
    Route::get('/me/memberships', MembershipController::class)->name('me.memberships');

    Route::middleware('verified')->group(function (): void {
        Route::put('/me/context', ContextController::class)->name('me.context.update');

        Route::get('/me/devices', [DeviceController::class, 'index'])->name('me.devices.index');

        // Step-up: cutting off a stolen phone must not be possible from a
        // hijacked session (plan §13 — 403 auth.step_up_required).
        Route::delete('/me/devices/{device}', [DeviceController::class, 'destroy'])
            ->middleware('step-up')
            ->name('me.devices.destroy');

        // The organisation-scoped probe of the vertical slice: headers,
        // membership and permission proven end to end.
        Route::get('/organisations/current', CurrentOrganisationController::class)
            ->middleware(['org.context', 'branch.context', 'permission:organisation.view_current'])
            ->name('organisations.current');
    });
});
