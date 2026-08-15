<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use App\Models\User;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Fortify\Contracts\VerifyEmailResponse;

/**
 * GET /api/v1/auth/verify-email/{id}/{hash} — the signed link in the mail.
 *
 * Fortify's stock controller insists the caller is already authenticated and
 * compares the route identifier to `$request->user()`. That is correct for a
 * cookie session that registered in the same browser tab, but wrong for the
 * usual mail-client flow: the person follows the link in a bare browser with
 * no bearer token and no session cookie, and the signature plus hash are the
 * credential — not an existing login.
 *
 * `signed` middleware still validates expiry and tampering. This controller
 * resolves the account from the path, checks the hash, marks the address
 * verified, and answers JSON for API clients or redirects browsers to the
 * Expo verify screen so they can continue in the app they already signed into.
 */
final class SignedEmailVerificationController
{
    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): JsonResponse|RedirectResponse
    {
        $user = User::query()->whereKey((string) $request->route('id'))->first();

        if ($user === null
            || ! hash_equals(sha1($user->getEmailForVerification()), (string) $request->route('hash'))) {
            throw new ApiException(ErrorCode::AuthInvalidSignature);
        }

        if (! $user->hasVerifiedEmail() && $user->markEmailAsVerified()) {
            event(new Verified($user));
        }

        $user->refresh();

        if ($request->hasSession()) {
            $sessionUserId = Auth::guard('web')->id();
            if ($sessionUserId !== null && (string) $sessionUserId === (string) $user->getKey()) {
                Auth::guard('web')->login($user);
            }
        }

        if ($request->expectsJson()) {
            return app(VerifyEmailResponse::class)->toResponse($request);
        }

        return redirect()->away(
            rtrim((string) config('app.frontend_url'), '/').'/verify-email?verified=1',
        );
    }
}
