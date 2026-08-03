<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Controllers;

use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\EmailVerificationNotificationSentResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * POST /api/v1/auth/email/verification-notification
 *
 * Fortify's stock controller reads `hasVerifiedEmail()` from the in-memory
 * session user. A signed link may have verified the row while the cookie
 * session still holds the pre-verification model, so a resend would spuriously
 * fire another mail. Refresh when the mirror still says unverified.
 */
final class ResendEmailVerificationController
{
    /**
     * @throws ApiException
     */
    public function __invoke(Request $request): Response
    {
        $user = $request->user();

        if ($user === null) {
            throw new ApiException(ErrorCode::AuthUnauthenticated);
        }

        if ($user->email_verified_at === null) {
            $user->refresh();
        }

        if ($user->hasVerifiedEmail()) {
            return response()->noContent();
        }

        $user->sendEmailVerificationNotification();

        return app(EmailVerificationNotificationSentResponse::class)->toResponse($request);
    }
}
