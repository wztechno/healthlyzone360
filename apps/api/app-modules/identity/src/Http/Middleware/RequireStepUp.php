<?php

declare(strict_types=1);

namespace Healthy360\Identity\Http\Middleware;

use Closure;
use Healthy360\Identity\Services\StepUpGuard;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Guards sensitive actions behind a recent password confirmation (alias:
 * step-up).
 *
 * Deliberately not Laravel's `password.confirm` middleware: that responds 423
 * to JSON callers and redirects browsers to a view route. The Healthy360
 * contract is HTTP 403 with auth.step_up_required (plan §13), and the
 * confirmation state must work for bearer tokens as well as sessions.
 *
 * Applied to: DELETE /api/v1/me/devices/{device} and
 * DELETE /api/v1/auth/two-factor-authentication.
 *
 * ## The method parameter (J1)
 *
 * `step-up` still means `step-up:password` and the two routes above are
 * untouched — the default is the original behaviour, so no existing route
 * changes meaning by acquiring a parameter it does not pass. `step-up:otp`
 * demands a passcode confirmation instead, for the actions where possession of
 * the phone is the thing being proven rather than knowledge of the password.
 *
 * The refusal names the endpoint that satisfies *that* method, because a
 * client told only "step up required" cannot tell which of the two it needs,
 * and guessing costs the user a round trip and a confusing prompt.
 */
class RequireStepUp
{
    public function __construct(private readonly StepUpGuard $guard) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next, string $method = StepUpGuard::METHOD_PASSWORD): Response
    {
        if (! $this->guard->confirmed($request, $method)) {
            throw new ApiException(ErrorCode::AuthStepUpRequired, details: [
                'method' => $method,
                'confirmation_endpoint' => $method === StepUpGuard::METHOD_OTP
                    ? '/api/v1/verification/step-up'
                    : '/api/v1/auth/confirm-password',
            ]);
        }

        return $next($request);
    }
}
