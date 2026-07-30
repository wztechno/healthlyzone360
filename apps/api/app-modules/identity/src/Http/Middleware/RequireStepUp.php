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
 */
class RequireStepUp
{
    public function __construct(private readonly StepUpGuard $guard) {}

    /**
     * @param  Closure(Request): Response  $next
     *
     * @throws ApiException
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $this->guard->confirmed($request)) {
            throw new ApiException(ErrorCode::AuthStepUpRequired, details: [
                'confirmation_endpoint' => '/api/v1/auth/confirm-password',
            ]);
        }

        return $next($request);
    }
}
