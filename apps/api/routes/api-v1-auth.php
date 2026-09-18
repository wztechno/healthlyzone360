<?php

declare(strict_types=1);

use Healthy360\Identity\Http\Controllers\ConfirmPasswordController;
use Healthy360\Identity\Http\Controllers\ResendEmailVerificationController;
use Healthy360\Identity\Http\Controllers\SignedEmailVerificationController;
use Healthy360\Identity\Http\Controllers\TokenController;
use Healthy360\Identity\Http\Controllers\TwoFactorController;
use Healthy360\Organisations\Http\Controllers\StaffSignInDomainIndexController;
use Illuminate\Support\Facades\Route;
use Laravel\Fortify\Http\Controllers\AuthenticatedSessionController;
use Laravel\Fortify\Http\Controllers\NewPasswordController;
use Laravel\Fortify\Http\Controllers\PasswordController;
use Laravel\Fortify\Http\Controllers\PasswordResetLinkController;
use Laravel\Fortify\Http\Controllers\RegisteredUserController;
use Laravel\Fortify\Http\Controllers\TwoFactorAuthenticatedSessionController;

/*
|--------------------------------------------------------------------------
| Healthy360 authentication — /api/v1/auth
|--------------------------------------------------------------------------
|
| Registered by bootstrap/app.php with config('fortify.prefix') and
| config('fortify.middleware'). Fortify's own route file is disabled
| (Fortify::ignoreRoutes()) for three reasons:
|
|  * three stock endpoints answer with bare JSON rather than the Healthy360
|    envelope (two-factor QR code, secret key, recovery codes);
|  * DELETE two-factor-authentication must carry the `step-up` middleware,
|    which Fortify's route file cannot express;
|  * password confirmation must work for bearer tokens, and Fortify's
|    controller writes the confirmation into the session unconditionally.
|
| Everything Fortify does serve correctly is still served by Fortify's own
| controllers, bound to Healthy360 JSON responses in app/Http/Responses.
|
| `guest` middleware is deliberately absent: Laravel's implementation
| redirects an already-authenticated caller, which would put a non-envelope
| body on the wire.
|
*/

$auth = 'auth:sanctum';
$twoFactorLimiter = config('fortify.limiters.two-factor');
$verificationLimiter = config('fortify.limiters.verification');
$forgotPasswordLimiter = config('fortify.limiters.forgot-password');

/*
| Session credentials (first-party origins).
|
| `stateful` rejects a session-less caller with an actionable error instead
| of quietly "succeeding" without issuing a cookie; native clients use
| POST /token below.
*/
Route::post('/register', [RegisteredUserController::class, 'store'])->name('register.store');

Route::post('/login', [AuthenticatedSessionController::class, 'store'])
    ->middleware('stateful')
    ->name('login.store');

Route::post('/logout', [AuthenticatedSessionController::class, 'destroy'])
    ->middleware([$auth, 'stateful'])
    ->name('logout');

Route::post('/two-factor-challenge', [TwoFactorAuthenticatedSessionController::class, 'store'])
    ->middleware(array_filter(['stateful', $twoFactorLimiter ? 'throttle:'.$twoFactorLimiter : null]))
    ->name('two-factor.login.store');

/*
| Native credentials: a Sanctum personal access token bound to a device.
*/
Route::post('/token', TokenController::class)->name('token.store');

/*
| Password reset.
*/
Route::post('/forgot-password', [PasswordResetLinkController::class, 'store'])
    ->middleware(array_filter([$forgotPasswordLimiter ? 'throttle:'.$forgotPasswordLimiter : null]))
    ->name('password.email');

Route::post('/reset-password', [NewPasswordController::class, 'store'])->name('password.update');

/*
| Replacing a password you already know (AA1).
|
| Fortify has shipped this controller since the beginning and this file has
| never registered it, because until an administrator could open an account on
| somebody else's behalf, every password on the platform was chosen by the
| person who owned it and replaced through the emailed reset link.
|
| Provisioning changes that: `POST /organisations/{organisation}/staff` hands a
| working credential to two people, and `users.must_change_password` holds the
| new account on a change-password screen until this route clears it. So what
| the administrator carries out of that form is a credential good for exactly
| one sign-in.
|
| **`current_password` is required even on a forced first change**, and the
| shortcut of waiving it — they just signed in with it, after all — is
| deliberately not taken. A session is not a password: it survives on a shared
| terminal and in an unlocked phone. The whole value of this route is that it
| takes a credential away from whoever else holds it, and a version exercisable
| from an abandoned session would hand it to the wrong person instead.
|
| The session survives, unlike a reset — which is what lets a forced first
| change flow straight into the workspace rather than bouncing back to a login
| form. Named `user-password.update` to match Fortify's own convention and to
| stay distinct from `password.update`, which is the reset above.
*/
Route::put('/user/password', [PasswordController::class, 'update'])
    ->middleware($auth)
    ->name('user-password.update');

/*
| The domains a member of staff signs in under (AA1).
|
| Anonymous by construction: the sign-in screen renders the picker before
| anybody has signed in, so a guarded endpoint could not serve the screen it
| exists for.
|
| An anonymous list of tenant names looks inconsistent beside the invitation
| endpoints, which deliberately refuse to confirm that an organisation exists,
| so the difference is worth naming. Nothing here is a secret: an organisation's
| name is already on the public marketplace, and a staff domain is the
| right-hand side of every address that organisation has ever issued. Only
| organisations that have *set* a domain are listed, so appearing is opt-in, and
| only active ones, because a suspended tenant's staff cannot sign in and
| offering the option would be an invitation to a refusal.
*/
Route::get('/staff-domains', StaffSignInDomainIndexController::class)
    ->name('staff-domains.index');

/*
| Email verification. The signed link is generated by Laravel's VerifyEmail
| notification against the `verification.verify` route name, so the name is
| part of the contract.
*/
Route::post('/email/verification-notification', ResendEmailVerificationController::class)
    ->middleware(array_filter([$auth, $verificationLimiter ? 'throttle:'.$verificationLimiter : null]))
    ->name('verification.send');

Route::get('/verify-email/{id}/{hash}', SignedEmailVerificationController::class)
    ->middleware(array_filter(['signed', $verificationLimiter ? 'throttle:'.$verificationLimiter : null]))
    ->name('verification.verify');

/*
| Step-up: recent password confirmation for sensitive actions.
*/
Route::post('/confirm-password', [ConfirmPasswordController::class, 'store'])
    ->middleware($auth)
    ->name('password.confirm.store');

Route::get('/confirmed-password-status', [ConfirmPasswordController::class, 'show'])
    ->middleware($auth)
    ->name('password.confirmation');

/*
| TOTP two-factor authentication.
*/
Route::middleware($auth)->group(function (): void {
    Route::post('/two-factor-authentication', [TwoFactorController::class, 'store'])
        ->name('two-factor.enable');

    Route::post('/confirmed-two-factor-authentication', [TwoFactorController::class, 'confirm'])
        ->name('two-factor.confirm');

    Route::delete('/two-factor-authentication', [TwoFactorController::class, 'destroy'])
        ->middleware('step-up')
        ->name('two-factor.disable');

    Route::get('/two-factor-qr-code', [TwoFactorController::class, 'qrCode'])
        ->name('two-factor.qr-code');

    Route::get('/two-factor-secret-key', [TwoFactorController::class, 'secretKey'])
        ->name('two-factor.secret-key');

    Route::get('/two-factor-recovery-codes', [TwoFactorController::class, 'recoveryCodes'])
        ->name('two-factor.recovery-codes');

    Route::post('/two-factor-recovery-codes', [TwoFactorController::class, 'regenerateRecoveryCodes'])
        ->name('two-factor.regenerate-recovery-codes');
});
